import "./style.css";

import firebase from "firebase/app";
import "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBrH3N6y_0avVn0FSugiUzPBsXcd1n2X38",
  authDomain: "fir-rtc-9d91e.firebaseapp.com",
  projectId: "fir-rtc-9d91e",
  storageBucket: "fir-rtc-9d91e.appspot.com",
  messagingSenderId: "341107897875",
  appId: "1:341107897875:web:92ed8ca6f327cf2e9931e6",
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}
const firestore = firebase.firestore();

const servers = {
  iceServers: [
    {
      urls: "stun:openrelay.metered.ca:80",
    },
    {
      urls: "turn:openrelay.metered.ca:80",
      username: "openrelayproject",
      credential: "openrelayproject",
    },
    {
      urls: "turn:openrelay.metered.ca:443",
      username: "openrelayproject",
      credential: "openrelayproject",
    },
    {
      urls: "turn:openrelay.metered.ca:443?transport=tcp",
      username: "openrelayproject",
      credential: "openrelayproject",
    },
  ],
  iceCandidatePoolSize: 10,
};

// Global State
const pc = new RTCPeerConnection(servers);
let localStream = null;
let remoteStream = null;

// HTML elements
const webcamButton = document.getElementById("webcamButton");
const webcamVideo = document.getElementById("webcamVideo");
const callButton = document.getElementById("callButton");
const answerButton = document.getElementById("answerButton");
const remoteVideo = document.getElementById("remoteVideo");
const hangupButton = document.getElementById("hangupButton");
const params = new URLSearchParams(window.location.search);
const isHost = params.has("isHost");

// 0. Setup Video
window.onload = () => {
  document.getElementById("remote").style.display = "none";
  if (isHost) {
    document.getElementById("isClient").style.display = "none";
  } else {
    document.getElementById("isHost").style.display = "none";
  }
};

window.onbeforeunload = function (e) {
  if (hangupButton.disabled === false) {
    hangupButton.click();
  }
};

// 1. Setup media sources

webcamButton.onclick = async () => {
  localStream = await navigator.mediaDevices.getUserMedia({
    video: true,
    audio: false,
  });
  remoteStream = new MediaStream();

  // Push tracks from local stream to peer connection
  localStream.getTracks().forEach((track) => {
    pc.addTrack(track, localStream);
  });

  // Pull tracks from remote stream, add to video stream
  pc.ontrack = (event) => {
    event.streams[0].getTracks().forEach((track) => {
      remoteStream.addTrack(track);
    });
  };

  webcamVideo.srcObject = localStream;
  remoteVideo.srcObject = remoteStream;

  callButton.disabled = false;
  answerButton.disabled = false;
  webcamButton.disabled = true;
};

// 2. Create an offer
callButton.onclick = async () => {
  // Reference Firestore collections for signaling
  const callDoc = firestore.collection("calls").doc("miso");
  const offerCandidates = callDoc.collection("offerCandidates");
  const answerCandidates = callDoc.collection("answerCandidates");

  // Get candidates for caller, save to db
  pc.onicecandidate = (event) => {
    event.candidate && offerCandidates.add(event.candidate.toJSON());
  };

  // Create offer
  const offerDescription = await pc.createOffer();
  await pc.setLocalDescription(offerDescription);

  const offer = {
    sdp: offerDescription.sdp,
    type: offerDescription.type,
  };

  await callDoc.set({ offer });

  // Listen for remote answer
  callDoc.onSnapshot((snapshot) => {
    const data = snapshot.data();
    if (!pc.currentRemoteDescription && data?.answer) {
      const answerDescription = new RTCSessionDescription(data.answer);
      pc.setRemoteDescription(answerDescription);
    }
  });

  // When answered, add candidate to peer connection
  answerCandidates.onSnapshot((snapshot) => {
    snapshot.docChanges().forEach((change) => {
      if (change.type === "added") {
        const candidate = new RTCIceCandidate(change.doc.data());
        pc.addIceCandidate(candidate);
      }
    });
  });

  hangupButton.disabled = false;
  callButton.disabled = true;
  answerButton.disabled = true;
};

// 3. Answer the call with the unique ID
answerButton.onclick = async () => {
  const callDoc = firestore.collection("calls").doc("miso");
  const answerCandidates = callDoc.collection("answerCandidates");
  const offerCandidates = callDoc.collection("offerCandidates");

  if (!isHost) {
    document.getElementById("local").style.display = "none";
    document.getElementById("remote").style.display = "block";
  }

  pc.onicecandidate = (event) => {
    event.candidate && answerCandidates.add(event.candidate.toJSON());
  };

  const callData = (await callDoc.get()).data();

  const offerDescription = callData.offer;
  await pc.setRemoteDescription(new RTCSessionDescription(offerDescription));

  const answerDescription = await pc.createAnswer();
  await pc.setLocalDescription(answerDescription);

  const answer = {
    type: answerDescription.type,
    sdp: answerDescription.sdp,
  };

  await callDoc.update({ answer });

  offerCandidates.onSnapshot((snapshot) => {
    snapshot.docChanges().forEach((change) => {
      console.log(change);
      if (change.type === "added") {
        let data = change.doc.data();
        pc.addIceCandidate(new RTCIceCandidate(data));
      }
    });
  });

  callButton.disabled = true;
  answerButton.disabled = true;
  hangupButton.disabled = false;
};

hangupButton.onclick = async () => {
  if (params.has("isHost")) {
    const callDoc = firestore.collection("calls").doc("miso");
    callDoc.delete();
  }

  localStream.getTracks().forEach((track) => {
    track.stop();
  });

  // Pull tracks from remote stream, add to video stream
  if (remoteStream) {
    remoteStream.getTracks().forEach((track) => track.stop());
  }

  if (peerConnection) {
    peerConnection.close();
  }
};

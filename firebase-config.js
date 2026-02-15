// firebase-config.js - UPDATED FOR NEW PROJECT
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyD4EQjRWrHkICrNuCn6k9l3Yy0nLmEwXDg",
  authDomain: "restaurant-qr-app-fe547.firebaseapp.com",
  projectId: "restaurant-qr-app-fe547",
  storageBucket: "restaurant-qr-app-fe547.firebasestorage.app",
  messagingSenderId: "967269323794",
  appId: "1:967269323794:web:bbd51d91e6fc5b3d4cb4cb"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
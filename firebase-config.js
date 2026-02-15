// firebase-config.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyAv8CFsgzlJtvHuGCTFN0W0mEyoqL5lv2g",
  authDomain: "studio-1828194590-1241e.firebaseapp.com",
  projectId: "studio-1828194590-1241e",
  storageBucket: "studio-1828194590-1241e.firebasestorage.app",
  messagingSenderId: "70441151978",
  appId: "1:70441151978:web:f1d83fd216cf11a56b5693"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
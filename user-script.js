import { db, auth } from './firebase-config.js';
import { 
    signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { 
    doc, getDoc, collection, onSnapshot, addDoc, query, where, setDoc 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const urlParams = new URLSearchParams(window.location.search);
const resId = urlParams.get('resId');
const tableNo = urlParams.get('table') || "01";

// Persistent Data
let cart = JSON.parse(localStorage.getItem(`platto_cart_${resId}`)) || [];
let restaurantData = {};
let selectedPaymentMode = "";
let isRedeeming = false;
let userUID = "";

const loader = document.getElementById('loader');

async function init() {
    if (!resId) {
        document.body.innerHTML = "<div style='text-align:center; padding:100px;'><h3>⚠️ Please scan QR.</h3></div>";
        return;
    }

    // 1. Fetch Restaurant Data
    const resSnap = await getDoc(doc(db, "restaurants", resId));
    if (resSnap.exists()) {
        restaurantData = resSnap.data();
        renderBranding();
        handleAnnouncement();
    }

    // 2. Auth & Loyalty
    onAuthStateChanged(auth, (user) => {
        userUID = user ? user.uid : (localStorage.getItem('guest_id') || "g_" + Date.now());
        if(!user) localStorage.setItem('guest_id', userUID);
        fetchLoyalty();
        checkLiveOrders();
    });

    loadMenu();
    updateCartUI();
}

function renderBranding() {
    document.getElementById('res-name-display').innerText = restaurantData.name;
    document.getElementById('wait-time').innerText = restaurantData.prepTime || "20";
    document.getElementById('res-about-text').innerText = restaurantData.about || "";
    document.getElementById('tbl-no').innerText = tableNo;
    if(restaurantData.logoUrl) document.getElementById('res-logo').src = restaurantData.logoUrl;
    
    // WiFi & Socials
    if(restaurantData.wifiName) {
        document.getElementById('wifi-name').innerText = restaurantData.wifiName;
        document.getElementById('wifi-pass').innerText = restaurantData.wifiPass;
    }
    document.getElementById('link-ig').href = restaurantData.igLink || "#";
    document.getElementById('link-fb').href = restaurantData.fbLink || "#";
    document.getElementById('whatsapp-btn').href = `https://wa.me/91${restaurantData.ownerPhone}`;
}

function handleAnnouncement() {
    if(restaurantData.activeAnnouncement) {
        document.getElementById('announcement-modal').style.display = "flex";
        document.getElementById('ann-title').innerText = restaurantData.annTitle || "Notice";
        document.getElementById('ann-desc').innerText = restaurantData.annText || "";
    }
}

window.addToCart = (name, price) => {
    cart.push({ name, price });
    localStorage.setItem(`platto_cart_${resId}`, JSON.stringify(cart));
    updateCartUI();
};

function updateCartUI() {
    const total = cart.reduce((s, i) => s + parseInt(i.price), 0);
    if(cart.length > 0) {
        document.getElementById('cart-bar').style.display = "flex";
        document.getElementById('cart-qty').innerText = cart.length;
        document.getElementById('cart-total').innerText = total;
    }
}

window.openPaymentModal = () => {
    document.getElementById('paymentModal').style.display = "flex";
    let final = cart.reduce((s, i) => s + parseInt(i.price), 0);
    if(isRedeeming) final -= 10;
    document.getElementById('final-amt').innerText = final < 0 ? 0 : final;
};

window.setPayMode = (mode) => {
    selectedPaymentMode = mode;
    document.querySelectorAll('.payment-modes button').forEach(b => b.classList.remove('selected'));
    document.getElementById('mode-' + mode.toLowerCase()).classList.add('selected');
    
    if(mode === 'Online') {
        document.getElementById('qr-area').style.display = "block";
        const qrDiv = document.getElementById('payment-qr');
        qrDiv.innerHTML = "";
        const amt = document.getElementById('final-amt').innerText;
        new QRCode(qrDiv, { text: `upi://pay?pa=${restaurantData.upiId}&am=${amt}`, width: 140, height: 140 });
    } else {
        document.getElementById('qr-area').style.display = "none";
    }
    document.getElementById('final-confirm-btn').disabled = false;
};

window.confirmOrder = async () => {
    const name = document.getElementById('cust-name').value;
    if(!name) return alert("Enter Name");
    loader.style.display = "flex";
    
    const finalTotal = document.getElementById('final-amt').innerText;
    const orderData = {
        resId, table: tableNo, customerName: name, userUID,
        items: cart, total: finalTotal, status: "Pending",
        paymentMode: selectedPaymentMode, timestamp: new Date()
    };

    await addDoc(collection(db, "orders"), orderData);
    
    // Loyalty Update (₹100 = 10 pts)
    const earned = Math.floor(finalTotal / 100) * 10;
    const userRef = doc(db, "users", userUID);
    const snap = await getDoc(userRef);
    let pts = snap.exists() ? snap.data().points : 0;
    if(isRedeeming) pts -= 1000;
    await setDoc(userRef, { points: pts + earned }, { merge: true });

    localStorage.removeItem(`platto_cart_${resId}`);
    document.getElementById('paymentModal').style.display = "none";
    document.getElementById('success-screen').style.display = "flex";
    document.getElementById('s-name').innerText = name;
    document.getElementById('s-table').innerText = tableNo;
    loader.style.display = "none";
};

// Tracking
function checkLiveOrders() {
    const q = query(collection(db, "orders"), where("userUID", "==", userUID), where("status", "!=", "Picked Up"));
    onSnapshot(q, (snap) => {
        const list = document.getElementById('live-tracking-list');
        list.innerHTML = "";
        snap.forEach(d => {
            const o = d.data();
            list.innerHTML += `<div class="tracking-item"><b>${o.status}</b><br>Table ${o.table} | ₹${o.total}</div>`;
        });
    });
}

// Global UI Helpers
window.closeAnnouncement = () => document.getElementById('announcement-modal').style.display = "none";
window.openTracking = () => document.getElementById('trackingModal').style.display = "flex";
window.closeTracking = () => document.getElementById('trackingModal').style.display = "none";
window.openAuthModal = () => document.getElementById('authModal').style.display = "flex";
window.closeAuthModal = () => document.getElementById('authModal').style.display = "none";
window.closeModal = () => document.getElementById('paymentModal').style.display = "none";

async function fetchLoyalty() {
    const snap = await getDoc(doc(db, "users", userUID));
    let pts = snap.exists() ? snap.data().points : 0;
    document.getElementById('user-pts').innerText = pts;
    document.getElementById('redeem-btn').disabled = (pts < 1000);
}

window.redeemPoints = () => {
    isRedeeming = true;
    alert("₹10 Discount Applied!");
    openPaymentModal();
};

function loadMenu() {
    onSnapshot(collection(db, "restaurants", resId, "menu"), (snap) => {
        const list = document.getElementById('menu-list');
        list.innerHTML = "";
        const isVeg = document.getElementById('veg-toggle').checked;
        snap.forEach(d => {
            const item = d.data();
            if(isVeg && !item.name.toLowerCase().includes('veg')) return;
            list.innerHTML += `<div class="food-card">
                <div><h4>${item.name}</h4><b>₹${item.price}</b></div>
                <button class="add-btn" onclick="addToCart('${item.name}', ${item.price})">ADD</button>
            </div>`;
        });
        loader.style.display = "none";
    });
}

init();
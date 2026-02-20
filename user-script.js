import { auth, db } from './firebase-config.js';
import { 
    signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { 
    doc, getDoc, collection, onSnapshot, addDoc, query, where, setDoc, getDocs 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const urlParams = new URLSearchParams(window.location.search);
const resId = urlParams.get('resId');
const tableNo = urlParams.get('table') || "01";

// Persistent Data
let cart = JSON.parse(localStorage.getItem(`cart_${resId}`)) || [];
let total = 0;
let restaurantData = {};
let isRedeeming = false;
let userUID = "";

// --- Initialization ---
async function initApp() {
    if (!resId) {
        document.body.innerHTML = "<div style='text-align:center; padding:100px;'><h3>⚠️ Scan QR at Table</h3></div>";
        return;
    }

    // 1. Fetch Restaurant Settings
    const resSnap = await getDoc(doc(db, "restaurants", resId));
    if (resSnap.exists()) {
        restaurantData = resSnap.data();
        renderBranding();
        handleAnnouncement();
    }

    // 2. Auth Sync
    onAuthStateChanged(auth, (user) => {
        if(user) {
            userUID = user.uid;
            document.getElementById('order-history-section').style.display = "block";
            loadOrderHistory();
        } else {
            userUID = localStorage.getItem('platto_guest_id') || "g_" + Date.now();
            localStorage.setItem('platto_guest_id', userUID);
        }
        fetchLoyalty();
        checkLiveOrders();
    });

    loadMenu();
    updateCartUI();
}

// Feature 9: Branding & Socials
function renderBranding() {
    document.getElementById('res-name-display').innerText = restaurantData.name;
    document.getElementById('res-address-display').innerText = restaurantData.address || "";
    document.getElementById('wait-time').innerText = restaurantData.prepTime || "20";
    document.getElementById('res-about-text').innerText = restaurantData.about || "";
    document.getElementById('tbl-no').innerText = tableNo;
    
    if(restaurantData.logoUrl) document.getElementById('res-logo').src = restaurantData.logoUrl;
    if(restaurantData.wifiName) {
        document.getElementById('wifi-name').innerText = restaurantData.wifiName;
        document.getElementById('wifi-pass').innerText = restaurantData.wifiPass;
    }
    
    // Social Links
    document.getElementById('link-fb').href = restaurantData.fbLink || "#";
    document.getElementById('link-ig').href = restaurantData.igLink || "#";
    document.getElementById('link-yt').href = restaurantData.ytLink || "#";
    document.getElementById('whatsapp-btn').href = `https://wa.me/91${restaurantData.ownerPhone}`;
}

// Feature 10: Announcement Logic
function handleAnnouncement() {
    if(restaurantData.activeAnnouncement) {
        document.getElementById('announcement-modal').style.display = "flex";
        document.getElementById('announcement-title').innerText = restaurantData.announcementTitle || "Special!";
        document.getElementById('announcement-desc').innerText = restaurantData.announcementText || "Check out our new offers!";
        if(restaurantData.announcementImg) {
            const img = document.getElementById('announcement-img');
            img.src = restaurantData.announcementImg;
            img.style.display = "block";
        }
    }
}

// Feature 3: Persistent Cart
window.addToCart = (name, price) => {
    cart.push({ name, price });
    localStorage.setItem(`cart_${resId}`, JSON.stringify(cart));
    updateCartUI();
};

function updateCartUI() {
    total = cart.reduce((sum, item) => sum + parseInt(item.price), 0);
    if (cart.length > 0) {
        document.getElementById('cart-bar').style.display = 'flex';
        document.getElementById('cart-qty').innerText = `${cart.length} Items`;
        document.getElementById('cart-total').innerText = total;
    }
}

// Feature 7: Loyalty Points (₹100 = 10 Pts)
async function fetchLoyalty() {
    const userSnap = await getDoc(doc(db, "users", userUID));
    let pts = userSnap.exists() ? userSnap.data().points : 0;
    document.getElementById('user-pts').innerText = pts;
    const redeemBtn = document.getElementById('redeem-btn');
    if(pts >= 1000) {
        redeemBtn.disabled = false;
        redeemBtn.classList.add('active');
    }
}

window.redeemPoints = () => {
    isRedeeming = true;
    alert("₹10 Discount applied for 1000 points!");
    document.getElementById('loyalty-applied').style.display = "block";
    openPaymentModal();
};

// Feature 1: Real-time Order Tracking
function checkLiveOrders() {
    const q = query(collection(db, "orders"), where("userUID", "==", userUID), where("status", "!=", "Picked Up"));
    onSnapshot(q, (snapshot) => {
        const list = document.getElementById('live-tracking-list');
        list.innerHTML = "";
        snapshot.forEach(d => {
            const order = d.data();
            list.innerHTML += `
                <div class="tracking-item">
                    <span class="status-badge">${order.status}</span>
                    <p><b>Table ${order.table}</b></p>
                    <small>${order.items.length} Items | Total: ₹${order.total}</small>
                </div>`;
        });
    });
}

// Feature 6: Order Confirmation & Loyalty Earning
window.confirmOrder = async () => {
    const name = document.getElementById('cust-name').value;
    if(!name) return alert("Enter Name");

    let finalTotal = total;
    if(isRedeeming) finalTotal -= 10;

    const orderData = {
        resId, table: tableNo, customerName: name, userUID,
        items: cart, total: finalTotal, status: "Pending",
        paymentMode: selectedPaymentMode, timestamp: new Date()
    };

    await addDoc(collection(db, "orders"), orderData);

    // Update Loyalty Points (Earn 10 per ₹100)
    const earned = Math.floor(total / 100) * 10;
    const userRef = doc(db, "users", userUID);
    const userSnap = await getDoc(userRef);
    let pts = userSnap.exists() ? userSnap.data().points : 0;
    if(isRedeeming) pts -= 1000;
    await setDoc(userRef, { points: pts + earned }, { merge: true });

    // Success
    localStorage.removeItem(`cart_${resId}`);
    document.getElementById('paymentModal').style.display = "none";
    document.getElementById('success-screen').style.display = "flex";
    document.getElementById('summary-name').innerText = name;
    document.getElementById('summary-table').innerText = tableNo;
};

// Auth & UI Handlers
window.handleAuth = async () => { /* Logic for Login/Signup */ };
window.toggleAuthMode = () => { /* Logic to switch login/signup ui */ };
window.openAuthModal = () => document.getElementById('authModal').style.display = "flex";
window.closeAuthModal = () => document.getElementById('authModal').style.display = "none";
window.openTracking = () => document.getElementById('tracking-panel').style.display = "flex";
window.closeTracking = () => document.getElementById('tracking-panel').style.display = "none";
window.closeAnnouncement = () => document.getElementById('announcement-modal').style.display = "none";
window.scrollToTop = () => window.scrollTo({top: 0, behavior: 'smooth'});

initApp();
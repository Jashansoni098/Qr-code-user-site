import { db, auth } from './firebase-config.js';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, getDoc, collection, onSnapshot, addDoc, query, where, setDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const urlParams = new URLSearchParams(window.location.search);
const resId = urlParams.get('resId');
const tableNo = urlParams.get('table') || "01";

let cart = JSON.parse(localStorage.getItem(`p_cart_${resId}`)) || [];
let restaurantData = {};
let selectedPaymentMode = "";
let isRedeeming = false;
let authMode = "login";
let userUID = "";

const loader = document.getElementById('loader');

// ==========================================
// 1. CORE FUNCTIONS (Fixed & Global)
// ==========================================
window.addToCart = (name, price) => {
    cart.push({ id: Date.now(), name, price });
    localStorage.setItem(`p_cart_${resId}`, JSON.stringify(cart));
    updateCartUI();
    if(window.navigator.vibrate) window.navigator.vibrate(50);
};

window.removeFromCart = (index) => {
    cart.splice(index, 1);
    localStorage.setItem(`p_cart_${resId}`, JSON.stringify(cart));
    updateCartUI();
    window.renderCartList();
};

function updateCartUI() {
    const total = cart.reduce((s, i) => s + parseInt(i.price), 0);
    const cartBar = document.getElementById('cart-bar');
    if(cart.length > 0) {
        cartBar.style.display = "flex";
        document.getElementById('cart-qty').innerText = cart.length;
        document.getElementById('cart-total').innerText = total;
    } else {
        cartBar.style.display = "none";
    }
}

// ==========================================
// 2. MODAL CONTROLS
// ==========================================
window.openCartModal = () => {
    document.getElementById('cartModal').style.display = "flex";
    window.renderCartList();
};

window.renderCartList = () => {
    const list = document.getElementById('cart-items-list');
    const total = cart.reduce((s, i) => s + parseInt(i.price), 0);
    list.innerHTML = cart.length === 0 ? "<p>Your basket is empty</p>" : "";
    cart.forEach((item, index) => {
        list.innerHTML += `
            <div class="cart-item">
                <span>${item.name} <br> <small>₹${item.price}</small></span>
                <button onclick="window.removeFromCart(${index})"><i class="fas fa-trash"></i></button>
            </div>`;
    });
    document.getElementById('summary-subtotal').innerText = "₹" + total;
};

window.openPaymentModal = () => {
    if(cart.length === 0) return alert("Cart is empty!");
    document.getElementById('cartModal').style.display = "none";
    document.getElementById('paymentModal').style.display = "flex";
    
    let total = cart.reduce((s, i) => s + parseInt(i.price), 0);
    if(isRedeeming) {
        total -= 10;
        document.getElementById('loyalty-applied-line').style.display = "flex";
    }
    document.getElementById('final-amt').innerText = total < 0 ? 0 : total;
};

window.closeModal = (id) => document.getElementById(id).style.display = "none";

// ==========================================
// 3. AUTH LOGIC (Fixed Mismatch)
// ==========================================
window.toggleAuth = (mode) => {
    authMode = mode;
    document.getElementById('auth-title').innerText = mode === 'login' ? "Welcome Back" : "Create Account";
    document.getElementById('auth-action-btn').innerText = mode === 'login' ? "Login" : "Register";
    document.getElementById('tab-login').classList.toggle('active', mode === 'login');
    document.getElementById('tab-signup').classList.toggle('active', mode === 'signup');
};

window.handleAuth = async () => {
    const email = document.getElementById('auth-email').value;
    const pass = document.getElementById('auth-pass').value;
    if(!email || !pass) return alert("Fill details");

    loader.style.display = "flex";
    try {
        if(authMode === "login") {
            await signInWithEmailAndPassword(auth, email, pass);
            alert("Login Success!");
        } else {
            await createUserWithEmailAndPassword(auth, email, pass);
            alert("Signup Success!");
        }
        window.closeModal('authModal');
    } catch(e) { 
        alert(e.message); 
    }
    loader.style.display = "none";
};

// ==========================================
// 4. ORDER & TRACKING
// ==========================================
window.setPayMode = (mode) => {
    selectedPaymentMode = mode;
    document.getElementById('mode-online').classList.toggle('selected', mode === 'Online');
    document.getElementById('mode-cash').classList.toggle('selected', mode === 'Cash');
    
    if(mode === 'Online') {
        document.getElementById('qr-area').style.display = "block";
        const qrDiv = document.getElementById('payment-qr');
        qrDiv.innerHTML = "";
        const amt = document.getElementById('final-amt').innerText;
        new QRCode(qrDiv, { text: `upi://pay?pa=${restaurantData.upiId}&am=${amt}`, width: 150, height: 150 });
    } else {
        document.getElementById('qr-area').style.display = "none";
    }
    document.getElementById('final-confirm-btn').disabled = false;
};

window.confirmOrder = async () => {
    const name = document.getElementById('cust-name').value;
    if(!name) return alert("Please enter name");

    loader.style.display = "flex";
    const finalTotal = document.getElementById('final-amt').innerText;
    const orderData = {
        resId, table: tableNo, customerName: name, userUID,
        items: cart, total: finalTotal, status: "Pending",
        paymentMode: selectedPaymentMode, timestamp: new Date(),
        instruction: document.getElementById('chef-note').value
    };

    await addDoc(collection(db, "orders"), orderData);

    // Points update
    const userRef = doc(db, "users", userUID);
    const snap = await getDoc(userRef);
    let pts = snap.exists() ? snap.data().points : 0;
    if(isRedeeming) pts -= 1000;
    await setDoc(userRef, { points: pts + Math.floor(finalTotal/10) }, { merge: true });

    localStorage.removeItem(`p_cart_${resId}`);
    document.getElementById('paymentModal').style.display = "none";
    document.getElementById('success-screen').style.display = "flex";
    document.getElementById('s-name').innerText = name;
    document.getElementById('s-table').innerText = tableNo;
    loader.style.display = "none";
};

// ==========================================
// 5. INITIALIZATION
// ==========================================
async function init() {
    if (!resId) return;
    const resSnap = await getDoc(doc(db, "restaurants", resId));
    if (resSnap.exists()) {
        restaurantData = resSnap.data();
        document.getElementById('res-name-display').innerText = restaurantData.name;
        document.getElementById('wait-time').innerText = restaurantData.prepTime || "20";
        document.getElementById('res-about-text').innerText = restaurantData.about || "";
        document.getElementById('tbl-no').innerText = tableNo;
        if(restaurantData.logoUrl) document.getElementById('res-logo').src = restaurantData.logoUrl;
        
        if(restaurantData.wifiName) {
            document.getElementById('wifi-display').style.display = "block";
            document.getElementById('wifi-name').innerText = restaurantData.wifiName;
            document.getElementById('wifi-pass').innerText = restaurantData.wifiPass;
        }
    }

    onAuthStateChanged(auth, (user) => {
        userUID = user ? user.uid : (localStorage.getItem('p_guest_id') || "g_" + Date.now());
        if(!user) localStorage.setItem('p_guest_id', userUID);
        fetchLoyalty();
        checkLiveOrders();
    });

    loadMenu();
    updateCartUI();
}

function loadMenu() {
    onSnapshot(collection(db, "restaurants", resId, "menu"), (snap) => {
        const list = document.getElementById('menu-list');
        list.innerHTML = "";
        const isVeg = document.getElementById('veg-toggle').checked;
        snap.forEach(d => {
            const item = d.data();
            if(isVeg && !item.name.toLowerCase().includes('veg')) return;
            list.innerHTML += `
                <div class="food-card">
                    <div class="food-info"><h4>${item.name}</h4><b>₹${item.price}</b></div>
                    <button class="add-btn" onclick="window.addToCart('${item.name}', ${item.price})">ADD</button>
                </div>`;
        });
        loader.style.display = "none";
    });
}

function checkLiveOrders() {
    const q = query(collection(db, "orders"), where("userUID", "==", userUID));
    onSnapshot(q, (snap) => {
        const list = document.getElementById('live-tracking-list');
        list.innerHTML = "";
        snap.forEach(d => {
            const o = d.data();
            if(o.status !== "Picked Up") {
                list.innerHTML += `<div class="tracking-item"><b>${o.status}</b><br>Table ${o.table} | Total: ₹${o.total}</div>`;
            }
        });
    });
}

async function fetchLoyalty() {
    const snap = await getDoc(doc(db, "users", userUID));
    let pts = snap.exists() ? snap.data().points : 0;
    document.getElementById('user-pts').innerText = pts;
    document.getElementById('redeem-btn').disabled = (pts < 1000);
}

window.redeemPoints = () => { isRedeeming = true; alert("₹10 Discount applied!"); window.openCartModal(); };
window.openTracking = () => document.getElementById('trackingModal').style.display = "flex";
window.openAuthModal = () => document.getElementById('authModal').style.display = "flex";
window.closeAuthModal = () => document.getElementById('authModal').style.display = "none";
window.openOffersModal = () => alert("Offer: " + (restaurantData.offerText || "No Offers"));

init();
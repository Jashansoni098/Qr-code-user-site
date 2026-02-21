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

// --- Functions attached to window for HTML access ---
window.addToCart = (name, price) => {
    cart.push({ name, price });
    localStorage.setItem(`p_cart_${resId}`, JSON.stringify(cart));
    updateCartUI();
    alert(name + " added to basket!");
};

function updateCartUI() {
    const total = cart.reduce((s, i) => s + parseInt(i.price), 0);
    const cartBar = document.getElementById('cart-bar');
    const cartQty = document.getElementById('cart-qty');
    const cartTotal = document.getElementById('cart-total');

    if(cart.length > 0) {
        if(cartBar) cartBar.style.display = "flex";
        if(cartQty) cartQty.innerText = cart.length;
        if(cartTotal) cartTotal.innerText = total;
    } else {
        if(cartBar) cartBar.style.display = "none";
    }
}

window.openCartModal = () => {
    const modal = document.getElementById('cartModal');
    if(modal) modal.style.display = "flex";
    renderCartList();
};

function renderCartList() {
    const list = document.getElementById('cart-items-list');
    const subtotal = document.getElementById('summary-subtotal');
    if(!list) return;

    list.innerHTML = cart.length === 0 ? "<p>Your cart is empty</p>" : "";
    let total = 0;
    cart.forEach((item, index) => {
        total += parseInt(item.price);
        list.innerHTML += `<div class="cart-item"><span>${item.name} (₹${item.price})</span><button onclick="window.removeItem(${index})">❌</button></div>`;
    });
    if(subtotal) subtotal.innerText = "₹" + total;
}

window.removeItem = (index) => {
    cart.splice(index, 1);
    localStorage.setItem(`p_cart_${resId}`, JSON.stringify(cart));
    updateCartUI();
    renderCartList();
};

window.setPayMode = (mode) => {
    selectedPaymentMode = mode;
    const btnOnline = document.getElementById('mode-online');
    const btnCash = document.getElementById('mode-cash');
    const qrArea = document.getElementById('qr-area');
    const finalBtn = document.getElementById('final-confirm-btn');

    if(btnOnline) btnOnline.classList.toggle('selected', mode === 'Online');
    if(btnCash) btnCash.classList.toggle('selected', mode === 'Cash');
    
    if(mode === 'Online' && qrArea) {
        qrArea.style.display = "block";
        const qrDiv = document.getElementById('payment-qr');
        qrDiv.innerHTML = "";
        const amt = document.getElementById('final-amt').innerText;
        new QRCode(qrDiv, { text: `upi://pay?pa=${restaurantData.upiId}&am=${amt}`, width: 140, height: 140 });
    } else if(qrArea) {
        qrArea.style.display = "none";
    }
    if(finalBtn) finalBtn.disabled = false;
};

window.confirmOrder = async () => {
    const nameInput = document.getElementById('cust-name');
    const finalAmtEl = document.getElementById('final-amt');
    const name = nameInput ? nameInput.value.trim() : "";

    if(!name) return alert("Please enter your name!");

    if(loader) loader.style.display = "flex";
    try {
        const orderData = {
            resId, table: tableNo, customerName: name, userUID,
            items: cart, total: finalAmtEl ? finalAmtEl.innerText : 0, 
            status: "Pending", paymentMode: selectedPaymentMode, 
            timestamp: new Date(), instruction: document.getElementById('chef-note').value
        };

        await addDoc(collection(db, "orders"), orderData);

        // Success elements fix
        const success = document.getElementById('success-screen');
        const sName = document.getElementById('s-name');
        const sTable = document.getElementById('s-table');
        const payModal = document.getElementById('paymentModal');

        if(payModal) payModal.style.display = "none";
        if(success) success.style.display = "flex";
        if(sName) sName.innerText = name;
        if(sTable) sTable.innerText = tableNo;

        localStorage.removeItem(`p_cart_${resId}`);
    } catch(e) { alert(e.message); }
    if(loader) loader.style.display = "none";
};

// --- AUTH ---
window.toggleAuth = (mode) => {
    authMode = mode;
    document.getElementById('tab-login').classList.toggle('active', mode==='login');
    document.getElementById('tab-signup').classList.toggle('active', mode==='signup');
    document.getElementById('auth-action-btn').innerText = mode==='login' ? "Login" : "Sign Up";
};

window.handleAuth = async () => {
    const email = document.getElementById('auth-email').value;
    const pass = document.getElementById('auth-pass').value;
    try {
        if(authMode === 'login') await signInWithEmailAndPassword(auth, email, pass);
        else await createUserWithEmailAndPassword(auth, email, pass);
        alert("Success!");
        window.closeModal('authModal');
    } catch(e) { alert(e.message); }
};

// --- Modals ---
window.openPaymentModal = () => {
    document.getElementById('cartModal').style.display = "none";
    document.getElementById('paymentModal').style.display = "flex";
    const total = cart.reduce((s, i) => s + parseInt(i.price), 0);
    const finalAmt = document.getElementById('final-amt');
    if(finalAmt) finalAmt.innerText = total;
};

window.closeModal = (id) => { const m = document.getElementById(id); if(m) m.style.display = "none"; };
window.openTracking = () => document.getElementById('trackingModal').style.display = "flex";
window.openAuthModal = () => document.getElementById('authModal').style.display = "flex";
window.closeAuthModal = () => window.closeModal('authModal');
window.openOffersModal = () => alert("Offer: " + (restaurantData.offerText || "No Offers"));

// --- INIT ---
async function init() {
    const resSnap = await getDoc(doc(db, "restaurants", resId));
    if (resSnap.exists()) {
        restaurantData = resSnap.data();
        document.getElementById('res-name-display').innerText = restaurantData.name;
        if(restaurantData.logoUrl) document.getElementById('res-logo').src = restaurantData.logoUrl;
    }
    onAuthStateChanged(auth, (user) => {
        userUID = user ? user.uid : "g_" + Date.now();
        fetchLoyalty();
        loadMenu();
    });
    updateCartUI();
}

async function fetchLoyalty() {
    const snap = await getDoc(doc(db, "users", userUID));
    let pts = snap.exists() ? snap.data().points : 0;
    const ptsEl = document.getElementById('user-pts');
    if(ptsEl) ptsEl.innerText = pts;
}

function loadMenu() {
    onSnapshot(collection(db, "restaurants", resId, "menu"), (snap) => {
        const list = document.getElementById('menu-list');
        if(!list) return;
        list.innerHTML = "";
        snap.forEach(d => {
            const item = d.data();
            list.innerHTML += `<div class="food-card"><div><h4>${item.name}</h4><b>₹${item.price}</b></div><button class="add-btn" onclick="window.addToCart('${item.name}', ${item.price})">ADD</button></div>`;
        });
        if(loader) loader.style.display = "none";
    });
}

init();
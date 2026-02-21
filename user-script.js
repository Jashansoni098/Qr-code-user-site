import { db, auth } from './firebase-config.js';
import { 
    signInWithEmailAndPassword, 
    createUserWithEmailAndPassword, 
    onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { 
    doc, getDoc, collection, onSnapshot, addDoc, query, where, setDoc 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// Global Variables
const urlParams = new URLSearchParams(window.location.search);
const resId = urlParams.get('resId');
const tableNo = urlParams.get('table') || "01";

let cart = JSON.parse(localStorage.getItem(`p_cart_${resId}`)) || [];
let restaurantData = {};
let selectedPaymentMode = "";
let isRedeeming = false;
let currentAuthMode = "login"; // Default mode
let userUID = "";

const loader = document.getElementById('loader');

// ==========================================
// 1. AUTH LOGIC (FIXED)
// ==========================================
window.toggleAuth = (mode) => {
    currentAuthMode = mode;
    const title = document.getElementById('auth-title');
    const btn = document.getElementById('auth-action-btn');
    const tabLogin = document.getElementById('tab-login');
    const tabSignup = document.getElementById('tab-signup');

    if (mode === 'login') {
        if(title) title.innerText = "Welcome Back";
        if(btn) btn.innerText = "Login";
        if(tabLogin) tabLogin.classList.add('active');
        if(tabSignup) tabSignup.classList.remove('active');
    } else {
        if(title) title.innerText = "Create Account";
        if(btn) btn.innerText = "Sign Up";
        if(tabSignup) tabSignup.classList.add('active');
        if(tabLogin) tabLogin.classList.remove('active');
    }
};

window.handleAuth = async () => {
    const email = document.getElementById('auth-email').value.trim();
    const pass = document.getElementById('auth-pass').value.trim();

    if (!email || !pass) return alert("Email and Password are required!");
    if (pass.length < 6) return alert("Password must be at least 6 characters.");

    if(loader) loader.style.display = "flex";
    
    try {
        if (currentAuthMode === "login") {
            // LOGIN
            await signInWithEmailAndPassword(auth, email, pass);
            alert("Login Successful! Your points are now synced.");
        } else {
            // SIGNUP
            await createUserWithEmailAndPassword(auth, email, pass);
            alert("Account Created! You can now earn loyalty points.");
        }
        window.closeModal('authModal');
    } catch (error) {
        console.error("Auth Error Code:", error.code);
        // User-friendly error messages
        if (error.code === 'auth/email-already-in-use') alert("This email is already registered. Please Login.");
        else if (error.code === 'auth/invalid-credential') alert("Invalid Email or Password.");
        else if (error.code === 'auth/weak-password') alert("Password is too weak.");
        else alert("Error: " + error.message);
    }
    if(loader) loader.style.display = "none";
};

// ==========================================
// 2. ADD TO CART & VIEW CART (FIXED)
// ==========================================
window.addToCart = (name, price) => {
    cart.push({ id: Date.now(), name, price });
    localStorage.setItem(`p_cart_${resId}`, JSON.stringify(cart));
    updateCartUI();
    
    // Notification to user
    const btn = event.target;
    const originalText = btn.innerText;
    btn.innerText = "ADDED ✅";
    btn.style.background = "#22c55e";
    setTimeout(() => {
        btn.innerText = originalText;
        btn.style.background = "";
    }, 1000);
};

function updateCartUI() {
    const total = cart.reduce((s, i) => s + parseInt(i.price), 0);
    const cartBar = document.getElementById('cart-bar');
    if(cart.length > 0) {
        if(cartBar) cartBar.style.display = "flex";
        document.getElementById('cart-qty').innerText = cart.length;
        document.getElementById('cart-total').innerText = total;
    } else {
        if(cartBar) cartBar.style.display = "none";
    }
}

window.openCartModal = () => {
    document.getElementById('cartModal').style.display = "flex";
    renderCartItems();
};

function renderCartItems() {
    const list = document.getElementById('cart-items-list');
    const subtotal = document.getElementById('summary-subtotal');
    if(!list) return;

    list.innerHTML = cart.length === 0 ? "<p style='padding:20px; color:gray;'>Your basket is empty</p>" : "";
    let totalAmt = 0;
    
    cart.forEach((item, index) => {
        totalAmt += parseInt(item.price);
        list.innerHTML += `
            <div class="cart-item">
                <div>
                    <b>${item.name}</b><br>
                    <small>₹${item.price}</small>
                </div>
                <button onclick="window.removeItem(${index})" style="color:red; border:none; background:none;">
                    <i class="fas fa-trash"></i>
                </button>
            </div>`;
    });
    if(subtotal) subtotal.innerText = "₹" + totalAmt;
}

window.removeItem = (index) => {
    cart.splice(index, 1);
    localStorage.setItem(`p_cart_${resId}`, JSON.stringify(cart));
    updateCartUI();
    renderCartItems();
};

// ==========================================
// 3. CHECKOUT & TRACKING
// ==========================================
window.openPaymentModal = () => {
    if(cart.length === 0) return alert("Add items first!");
    window.closeModal('cartModal');
    document.getElementById('paymentModal').style.display = "flex";
    
    let subtotal = cart.reduce((s, i) => s + parseInt(i.price), 0);
    if(isRedeeming) subtotal -= 10;
    
    const finalAmtEl = document.getElementById('final-amt');
    if(finalAmtEl) finalAmtEl.innerText = subtotal < 0 ? 0 : subtotal;
};

window.setPayMode = (mode) => {
    selectedPaymentMode = mode;
    document.getElementById('mode-online').classList.toggle('selected', mode === 'Online');
    document.getElementById('mode-cash').classList.toggle('selected', mode === 'Cash');
    
    const qrArea = document.getElementById('qr-area');
    if(mode === 'Online' && qrArea) {
        qrArea.style.display = "block";
        const qrDiv = document.getElementById('payment-qr');
        qrDiv.innerHTML = "";
        const amt = document.getElementById('final-amt').innerText;
        new QRCode(qrDiv, { text: `upi://pay?pa=${restaurantData.upiId}&am=${amt}`, width: 140, height: 140 });
    } else if(qrArea) {
        qrArea.style.display = "none";
    }
    document.getElementById('final-confirm-btn').disabled = false;
};

window.confirmOrder = async () => {
    const name = document.getElementById('cust-name').value.trim();
    if(!name) return alert("Please enter your name!");

    if(loader) loader.style.display = "flex";
    try {
        const orderData = {
            resId, table: tableNo, customerName: name, userUID,
            items: cart, total: document.getElementById('final-amt').innerText,
            status: "Pending", paymentMode: selectedPaymentMode,
            timestamp: new Date(), instruction: document.getElementById('chef-note').value
        };

        await addDoc(collection(db, "orders"), orderData);

        // Success Screen
        document.getElementById('paymentModal').style.display = "none";
        document.getElementById('success-screen').style.display = "flex";
        document.getElementById('s-name').innerText = name;
        document.getElementById('s-table').innerText = tableNo;

        // Loyalty Update (Earn 10 per ₹100)
        const earned = Math.floor(parseInt(orderData.total) / 100) * 10;
        const userRef = doc(db, "users", userUID);
        const snap = await getDoc(userRef);
        let pts = snap.exists() ? snap.data().points : 0;
        if(isRedeeming) pts -= 1000;
        await setDoc(userRef, { points: pts + earned }, { merge: true });

        localStorage.removeItem(`p_cart_${resId}`);
        cart = [];
        updateCartUI();
    } catch(e) { alert(e.message); }
    if(loader) loader.style.display = "none";
};

// ==========================================
// 4. INITIALIZATION & LIVE SYNC
// ==========================================
async function init() {
    if (!resId) return;
    
    // Fetch Restaurant Details
    const resSnap = await getDoc(doc(db, "restaurants", resId));
    if (resSnap.exists()) {
        restaurantData = resSnap.data();
        document.getElementById('res-name-display').innerText = restaurantData.name;
        if(restaurantData.logoUrl) document.getElementById('res-logo').src = restaurantData.logoUrl;
        document.getElementById('wait-time').innerText = restaurantData.prepTime || "20";
        document.getElementById('res-about-text').innerText = restaurantData.about || "";
        document.getElementById('tbl-no').innerText = tableNo;
        
        // WiFi & Socials
        if(restaurantData.wifiName) {
            document.getElementById('wifi-display').style.display = "block";
            document.getElementById('wifi-name').innerText = restaurantData.wifiName;
            document.getElementById('wifi-pass').innerText = restaurantData.wifiPass;
        }
        document.getElementById('whatsapp-btn').href = `https://wa.me/91${restaurantData.ownerPhone}`;
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
        if(!list) return;
        list.innerHTML = "";
        const isVeg = document.getElementById('veg-toggle').checked;
        const search = document.getElementById('menu-search').value.toLowerCase();
        
        snap.forEach(d => {
            const item = d.data();
            if(isVeg && !item.name.toLowerCase().includes('veg')) return;
            if(search && !item.name.toLowerCase().includes(search)) return;
            
            list.innerHTML += `
                <div class="food-card">
                    <div class="food-info">
                        <h4>${item.name}</h4>
                        <b>₹${item.price}</b>
                    </div>
                    <button class="add-btn" onclick="window.addToCart('${item.name}', ${item.price})">ADD</button>
                </div>`;
        });
        if(loader) loader.style.display = "none";
    });
}

function checkLiveOrders() {
    const q = query(collection(db, "orders"), where("userUID", "==", userUID));
    onSnapshot(q, (snap) => {
        const list = document.getElementById('live-tracking-list');
        if(!list) return;
        list.innerHTML = snap.empty ? "<p>No active orders</p>" : "";
        snap.forEach(d => {
            const o = d.data();
            if(o.status !== "Picked Up") {
                list.innerHTML += `
                    <div class="tracking-item">
                        <span class="status-badge">${o.status}</span>
                        <b>Table ${o.table}</b><br>
                        <small>Total: ₹${o.total}</small>
                    </div>`;
            }
        });
    });
}

async function fetchLoyalty() {
    const snap = await getDoc(doc(db, "users", userUID));
    let pts = snap.exists() ? snap.data().points : 0;
    const ptsEl = document.getElementById('user-pts');
    const redeemBtn = document.getElementById('redeem-btn');
    if(ptsEl) ptsEl.innerText = pts;
    if(redeemBtn) redeemBtn.disabled = (pts < 1000);
}

// Global UI Helpers
window.closeModal = (id) => document.getElementById(id).style.display = "none";
window.openTracking = () => document.getElementById('trackingModal').style.display = "flex";
window.openAuthModal = () => document.getElementById('authModal').style.display = "flex";
window.closeAuthModal = () => window.closeModal('authModal');
window.openOffersModal = () => alert("Offers: " + (restaurantData.offerText || "No active offers"));
window.redeemPoints = () => { isRedeeming = true; alert("Loyalty Reward Applied: ₹10 Discount!"); window.openCartModal(); };

init();
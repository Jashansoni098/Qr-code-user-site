import { db, auth } from './firebase-config.js';
import { 
    signInWithEmailAndPassword, 
    createUserWithEmailAndPassword, 
    onAuthStateChanged,
    signOut 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { 
    doc, getDoc, collection, onSnapshot, addDoc, query, where, setDoc, updateDoc 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// Global Variables
const urlParams = new URLSearchParams(window.location.search);
const resId = urlParams.get('resId');
const tableNo = urlParams.get('table') || "01";

let cart = JSON.parse(localStorage.getItem(`p_cart_${resId}`)) || [];
let restaurantData = {};
let selectedPaymentMode = "";
let isRedeeming = false;
let currentAuthMode = "login";
let userUID = "";
let userPoints = 0;

const loader = document.getElementById('loader');

// ==========================================
// 1. AUTH & PROFILE LOGIC (Feature: Profile Switch)
// ==========================================
onAuthStateChanged(auth, async (user) => {
    const navAuthBtn = document.getElementById('nav-auth-btn');
    const navProfileBtn = document.getElementById('nav-profile-btn');

    if (user) {
        userUID = user.uid;
        // UI Switch: Hide Login, Show Profile
        if(navAuthBtn) navAuthBtn.style.display = "none";
        if(navProfileBtn) navProfileBtn.style.display = "flex";
        
        // Fetch User Data
        const userSnap = await getDoc(doc(db, "users", userUID));
        if (userSnap.exists()) {
            const data = userSnap.data();
            userPoints = data.points || 0;
            // Pre-fill Profile Modal
            if(document.getElementById('user-name')) document.getElementById('user-name').value = data.name || "";
            if(document.getElementById('user-phone')) document.getElementById('user-phone').value = data.phone || "";
            // Auto-fill Checkout Name
            if(document.getElementById('cust-name')) document.getElementById('cust-name').value = data.name || "";
        }
    } else {
        userUID = localStorage.getItem('p_guest_id') || "g_" + Date.now();
        if(!localStorage.getItem('p_guest_id')) localStorage.setItem('p_guest_id', userUID);
        if(navAuthBtn) navAuthBtn.style.display = "flex";
        if(navProfileBtn) navProfileBtn.style.display = "none";
    }
    updatePointsUI();
    loadMenu();
    checkLiveOrders();
});

window.saveUserProfile = async () => {
    const name = document.getElementById('user-name').value.trim();
    const phone = document.getElementById('user-phone').value.trim();
    if(!name || !phone) return alert("Please enter Name and Mobile Number!");

    if(loader) loader.style.display = "flex";
    try {
        await setDoc(doc(db, "users", userUID), { 
            name: name, 
            phone: phone 
        }, { merge: true });
        alert("Profile details saved successfully!");
        window.closeModal('profileModal');
    } catch(e) { alert("Error: " + e.message); }
    if(loader) loader.style.display = "none";
};

window.logout = () => {
    if(confirm("Do you want to logout?")) {
        signOut(auth).then(() => location.reload());
    }
};

window.handleAuth = async () => {
    const email = document.getElementById('auth-email').value.trim();
    const pass = document.getElementById('auth-pass').value.trim();
    if (!email || !pass) return alert("Fill all fields!");

    if(loader) loader.style.display = "flex";
    try {
        if (currentAuthMode === "login") {
            await signInWithEmailAndPassword(auth, email, pass);
        } else {
            await createUserWithEmailAndPassword(auth, email, pass);
            // Initial points for new user
            await setDoc(doc(db, "users", auth.currentUser.uid), { points: 0, email: email });
        }
        window.closeModal('authModal');
    } catch (error) { alert(error.message); }
    if(loader) loader.style.display = "none";
};

// ==========================================
// 2. CART & REDEEM LOGIC (Feature: Integrated Redeem)
// ==========================================
window.addToCart = (name, price) => {
    cart.push({ id: Date.now(), name, price });
    localStorage.setItem(`p_cart_${resId}`, JSON.stringify(cart));
    updateCartUI();
    
    const btn = event.target;
    btn.innerText = "ADDED ✅";
    setTimeout(() => btn.innerText = "ADD", 800);
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
    const subtotalEl = document.getElementById('summary-subtotal');
    const redeemSec = document.getElementById('redeem-section');
    if(!list) return;

    list.innerHTML = cart.length === 0 ? "<p style='padding:20px; color:gray;'>Empty Basket</p>" : "";
    let subtotal = 0;
    
    cart.forEach((item, index) => {
        subtotal += parseInt(item.price);
        list.innerHTML += `
            <div class="cart-item">
                <span><b>${item.name}</b><br><small>₹${item.price}</small></span>
                <button onclick="window.removeItem(${index})"><i class="fas fa-trash"></i></button>
            </div>`;
    });

    if(subtotalEl) subtotalEl.innerText = "₹" + subtotal;

    // Show Redeem UI only if points >= 1000 and cart not empty
    if(userPoints >= 1000 && cart.length > 0) {
        if(redeemSec) redeemSec.style.display = "block";
        document.getElementById('available-pts').innerText = userPoints;
    } else if(redeemSec) {
        redeemSec.style.display = "none";
    }
}

window.applyRedeem = () => {
    isRedeeming = true;
    document.getElementById('discount-line').style.display = "flex";
    document.getElementById('apply-redeem-btn').innerText = "✅ APPLIED";
    document.getElementById('apply-redeem-btn').disabled = true;
    alert("₹10 Discount will be applied on checkout!");
};

window.removeItem = (index) => {
    cart.splice(index, 1);
    localStorage.setItem(`p_cart_${resId}`, JSON.stringify(cart));
    updateCartUI();
    renderCartItems();
};

// ==========================================
// 3. CHECKOUT & ORDER
// ==========================================
window.openPaymentModal = () => {
    if(cart.length === 0) return alert("Cart is empty!");
    window.closeModal('cartModal');
    document.getElementById('paymentModal').style.display = "flex";
    
    let subtotal = cart.reduce((s, i) => s + parseInt(i.price), 0);
    if(isRedeeming) subtotal -= 10;
    
    const finalAmtEl = document.getElementById('final-amt');
    if(finalAmtEl) finalAmtEl.innerText = subtotal < 0 ? 0 : subtotal;
};

window.confirmOrder = async () => {
    const name = document.getElementById('cust-name').value.trim();
    if(!name) return alert("Enter your name!");

    if(loader) loader.style.display = "flex";
    try {
        const finalBill = parseInt(document.getElementById('final-amt').innerText);
        const orderData = {
            resId, table: tableNo, customerName: name, userUID,
            items: cart, total: finalBill,
            status: "Pending", paymentMode: selectedPaymentMode,
            timestamp: new Date(), instruction: document.getElementById('chef-note').value
        };

        await addDoc(collection(db, "orders"), orderData);

        // Success Screen
        document.getElementById('paymentModal').style.display = "none";
        document.getElementById('success-screen').style.display = "flex";
        document.getElementById('s-name').innerText = name;
        document.getElementById('s-table').innerText = tableNo;

        // Loyalty Update: Earn 10 pts per ₹100 spend
        const earned = Math.floor(finalBill / 100) * 10;
        let newTotalPts = userPoints + earned;
        if(isRedeeming) newTotalPts -= 1000;
        
        await setDoc(doc(db, "users", userUID), { points: newTotalPts }, { merge: true });

        localStorage.removeItem(`p_cart_${resId}`);
        cart = [];
        isRedeeming = false;
        updateCartUI();
    } catch(e) { alert(e.message); }
    if(loader) loader.style.display = "none";
};

// ==========================================
// 4. INITIALIZATION & SYNC
// ==========================================
async function init() {
    if (!resId) return;
    const resSnap = await getDoc(doc(db, "restaurants", resId));
    if (resSnap.exists()) {
        restaurantData = resSnap.data();
        document.getElementById('res-name-display').innerText = restaurantData.name;
        if(restaurantData.logoUrl) document.getElementById('res-logo').src = restaurantData.logoUrl;
        document.getElementById('wait-time').innerText = restaurantData.prepTime || "20";
        document.getElementById('res-about-text').innerText = restaurantData.about || "Welcome!";
        document.getElementById('tbl-no').innerText = tableNo;
        
        if(restaurantData.wifiName) {
            document.getElementById('wifi-display').style.display = "block";
            document.getElementById('wifi-name').innerText = restaurantData.wifiName;
            document.getElementById('wifi-pass').innerText = restaurantData.wifiPass;
        }
        document.getElementById('whatsapp-btn').href = `https://wa.me/91${restaurantData.ownerPhone}`;
    }
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
            list.innerHTML += `<div class="food-card"><div><h4>${item.name}</h4><b>₹${item.price}</b></div><button class="add-btn" onclick="window.addToCart('${item.name}', ${item.price})">ADD</button></div>`;
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
            if(o.status !== "Picked Up" && o.status !== "Rejected") {
                list.innerHTML += `<div class="tracking-item"><span class="status-badge">${o.status}</span><b>Table ${o.table}</b><br><small>Total: ₹${o.total}</small></div>`;
            }
        });
    });
}

function updatePointsUI() {
    const ptsEl = document.getElementById('user-pts');
    const profilePtsEl = document.getElementById('profile-pts');
    if(ptsEl) ptsEl.innerText = userPoints;
    if(profilePtsEl) profilePtsEl.innerText = userPoints;
}

// Global UI Toggles
window.toggleAuth = (mode) => {
    currentAuthMode = mode;
    document.getElementById('tab-login').classList.toggle('active', mode==='login');
    document.getElementById('tab-signup').classList.toggle('active', mode==='signup');
    document.getElementById('auth-action-btn').innerText = mode==='login' ? "Login" : "Sign Up";
};
window.openProfileModal = () => document.getElementById('profileModal').style.display = "flex";
window.openAuthModal = () => document.getElementById('authModal').style.display = "flex";
window.setPayMode = (mode) => {
    selectedPaymentMode = mode;
    document.getElementById('mode-online').classList.toggle('selected', mode === 'Online');
    document.getElementById('mode-cash').classList.toggle('selected', mode === 'Cash');
    if(mode === 'Online') {
        document.getElementById('qr-area').style.display = "block";
        const qrDiv = document.getElementById('payment-qr');
        qrDiv.innerHTML = "";
        const amt = document.getElementById('final-amt').innerText;
        new QRCode(qrDiv, { text: `upi://pay?pa=${restaurantData.upiId}&am=${amt}`, width: 140, height: 140 });
    } else { document.getElementById('qr-area').style.display = "none"; }
    document.getElementById('final-confirm-btn').disabled = false;
};
window.closeModal = (id) => document.getElementById(id).style.display = "none";
window.openTracking = () => document.getElementById('trackingModal').style.display = "flex";
window.openOffersModal = () => alert("Offers: " + (restaurantData.offerText || "No Offers"));
window.closeSuccess = () => location.reload();

init();
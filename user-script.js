import { db, auth } from './firebase-config.js';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, getDoc, collection, onSnapshot, addDoc, query, where, setDoc, getDocs, orderBy } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const urlParams = new URLSearchParams(window.location.search);
const resId = urlParams.get('resId');
const tableNo = urlParams.get('table') || "01";

let cart = JSON.parse(localStorage.getItem(`pl_cart_${resId}`)) || [];
let restaurantData = {};
let selectedPaymentMode = "";
let orderType = "Pickup";
let isRedeeming = false;
let userUID = "";
let userPoints = 0;
let currentItem = null;
let currentAuthMode = "login";

const loader = document.getElementById('loader');

// --- APP CORE ---
async function init() {
    if (!resId) return;
    const resSnap = await getDoc(doc(db, "restaurants", resId));
    if (resSnap.exists()) {
        restaurantData = resSnap.data();
        renderInfo();
        renderCategories();
        handleAnnouncement();
    }
    onAuthStateChanged(auth, async (user) => {
        userUID = user ? user.uid : (localStorage.getItem('p_guest_id') || "g_" + Date.now());
        if(!user) localStorage.setItem('p_guest_id', userUID);
        
        document.getElementById('nav-auth-btn').style.display = user ? "none" : "flex";
        document.getElementById('nav-profile-btn').style.display = user ? "flex" : "none";
        
        const uSnap = await getDoc(doc(db, "users", userUID));
        if(uSnap.exists()) {
            userPoints = uSnap.data().points || 0;
            updatePointsUI();
            document.getElementById('user-profile-name').value = uSnap.data().name || "";
        }
        loadMenu();
        checkLiveOrders();
    });
}

// --- FIX: Reference & Logic Mappings ---
window.updateCartUI = () => {
    const totalAmt = cart.reduce((s, i) => s + i.price, 0);
    const bar = document.getElementById('cart-bar');
    if(cart.length > 0 && bar) {
        bar.style.display = "flex";
        document.getElementById('cart-qty').innerText = cart.length;
        document.getElementById('cart-total').innerText = totalAmt;
    } else if(bar) bar.style.display = "none";
};

window.addToCart = (name, price) => {
    cart.push({ id: Date.now(), name, price });
    localStorage.setItem(`pl_cart_${resId}`, JSON.stringify(cart));
    window.updateCartUI();
    alert(name + " added!");
};

window.updatePointsUI = () => {
    const ptsEl = document.getElementById('user-pts');
    const redeemBtn = document.getElementById('redeem-btn');
    if(ptsEl) ptsEl.innerText = userPoints;
    if(redeemBtn) redeemBtn.disabled = userPoints < 1000;
};

// --- Modals Logic ---
window.openCartModal = () => {
    document.getElementById('cartModal').style.display = "flex";
    const list = document.getElementById('cart-items-list');
    list.innerHTML = "";
    let sub = 0;
    cart.forEach((item, index) => {
        sub += item.price;
        list.innerHTML += `<div style="display:flex; justify-content:space-between; padding:10px; border-bottom:1px solid #eee;"><span>${item.name}</span><b>₹${item.price}</b></div>`;
    });
    document.getElementById('summary-subtotal').innerText = "₹" + sub;
    document.getElementById('summary-total').innerText = "₹" + (isRedeeming ? sub - 10 : sub);
};

window.openCheckoutModal = () => {
    if(cart.length === 0) return alert("Cart empty");
    window.closeModal('cartModal');
    document.getElementById('checkoutModal').style.display = "flex";
    const sub = cart.reduce((s, i) => s + i.price, 0);
    document.getElementById('final-amt').innerText = isRedeeming ? sub - 10 : sub;
};

window.setPayMode = (mode) => {
    selectedPaymentMode = mode;
    document.getElementById('mode-online').classList.toggle('selected', mode === 'Online');
    document.getElementById('mode-cash').classList.toggle('selected', mode === 'Cash');
    if(mode === 'Online') {
        document.getElementById('payment-qr-area').style.display = "block";
        const qrDiv = document.getElementById('checkout-payment-qr'); qrDiv.innerHTML = "";
        new QRCode(qrDiv, { text: `upi://pay?pa=${restaurantData.upiId}&am=${document.getElementById('final-amt').innerText}`, width: 140, height: 140 });
    } else document.getElementById('payment-qr-area').style.display = "none";
    document.getElementById('final-confirm-btn').disabled = false;
};

window.confirmOrder = async () => {
    const name = document.getElementById('cust-name-final').value;
    if(!name) return alert("Enter Name");
    loader.style.display = "flex";
    const finalBill = document.getElementById('final-amt').innerText;
    const orderData = {
        resId, table: tableNo, customerName: name, userUID, items: cart,
        total: finalBill, status: "Pending", paymentMode: selectedPaymentMode,
        orderType, timestamp: new Date(), note: document.getElementById('chef-note').value
    };
    await addDoc(collection(db, "orders"), orderData);
    
    let newPts = userPoints + Math.floor(parseInt(finalBill)/10);
    if(isRedeeming) newPts -= 1000;
    await setDoc(doc(db, "users", userUID), { points: newPts }, { merge: true });

    localStorage.removeItem(`pl_cart_${resId}`);
    document.getElementById('checkoutModal').style.display = "none";
    document.getElementById('success-screen').style.display = "flex";
    document.getElementById('s-name').innerText = name;
    loader.style.display = "none";
};

// --- PIZZA CUSTOMIZE ---
window.openCustomize = (id, item) => {
    currentItem = { ...item, id };
    document.getElementById('cust-item-name').innerText = item.name;
    document.getElementById('p-price-s').innerText = "₹" + item.price;
    document.getElementById('p-price-m').innerText = "₹" + (parseInt(item.price) + 50);
    document.getElementById('p-price-l').innerText = "₹" + (parseInt(item.price) + 100);
    const exDiv = document.getElementById('extras-options');
    exDiv.innerHTML = "";
    if(restaurantData.variants) {
        restaurantData.variants.forEach(v => {
            exDiv.innerHTML += `<label class="option-row"><span><input type="checkbox" class="ex-chk" value="${v.name}" data-price="${v.price}"> ${v.name}</span><b>+₹${v.price}</b></label>`;
        });
    }
    document.getElementById('customizeModal').style.display = "flex";
};

window.addCustomizedToCart = () => {
    const size = document.querySelector('input[name="p-size"]:checked').value;
    let price = parseInt(currentItem.price);
    if(size === 'Medium') price += 50; if(size === 'Large') price += 100;
    document.querySelectorAll('.ex-chk:checked').forEach(el => price += parseInt(el.dataset.price));
    window.addToCart(`${currentItem.name} (${size})`, price);
    window.closeModal('customizeModal');
};

// --- HELPERS ---
function renderInfo() {
    document.getElementById('res-name-display').innerText = restaurantData.name;
    document.getElementById('wait-time').innerText = restaurantData.prepTime || "20";
    document.getElementById('res-about-text').innerText = restaurantData.about || "";
    document.getElementById('tbl-no').innerText = tableNo;
    if(restaurantData.logoUrl) document.getElementById('res-logo').src = restaurantData.logoUrl;
    if(restaurantData.wifiName) {
        document.getElementById('wifi-display').style.display = "flex";
        document.getElementById('wifi-name').innerText = restaurantData.wifiName;
        document.getElementById('wifi-pass').innerText = restaurantData.wifiPass;
    }
    document.getElementById('link-ig').href = restaurantData.igLink || "#";
    document.getElementById('link-fb').href = restaurantData.fbLink || "#";
    document.getElementById('link-yt').href = restaurantData.ytLink || "#";
    document.getElementById('whatsapp-btn').href = `https://wa.me/91${restaurantData.ownerPhone}`;
}

function loadMenu(category = 'All') {
    onSnapshot(collection(db, "restaurants", resId, "menu"), (snap) => {
        const grid = document.getElementById('menu-list');
        grid.innerHTML = "";
        const isVeg = document.getElementById('veg-toggle').checked;
        const search = document.getElementById('menu-search').value.toLowerCase();
        snap.forEach(d => {
            const item = d.data();
            if(category !== 'All' && item.category !== category) return;
            if(isVeg && !item.name.toLowerCase().includes('veg')) return;
            if(search && !item.name.toLowerCase().includes(search)) return;
            grid.innerHTML += `<div class="food-card" onclick='window.openCustomize("${d.id}", ${JSON.stringify(item)})'>
                <img src="${item.imgUrl || 'https://via.placeholder.com/150'}" class="food-img">
                <div class="food-info"><h4>${item.name}</h4><b class="food-price">₹${item.price}</b></div>
            </div>`;
        });
        if(loader) loader.style.display = "none";
    });
}

function checkLiveOrders() {
    const q = query(collection(db, "orders"), where("userUID", "==", userUID));
    onSnapshot(q, (snap) => {
        const list = document.getElementById('order-history-list');
        if(!list) return;
        list.innerHTML = "";
        snap.forEach(d => {
            const o = d.data();
            if(o.status !== "Picked Up") {
                list.innerHTML += `<div style="padding:15px; border-bottom:1px solid #eee; text-align:left;">
                    <b style="color:var(--primary)">${o.status}</b><br>Table ${o.table} | ₹${o.total}
                </div>`;
            }
        });
    });
}

// Standard UI Mappings
window.renderCategories = () => { /* Injected via Init */ };
window.filterByCategory = (cat, btn) => {
    document.querySelectorAll('.cat-pill').forEach(b => b.classList.remove('active'));
    btn.classList.add('active'); loadMenu(cat);
};
window.closeModal = (id) => document.getElementById(id).style.display = "none";
window.openAuthModal = () => document.getElementById('authModal').style.display = "flex";
window.openProfileModal = () => document.getElementById('profileModal').style.display = "flex";
window.openTracking = () => document.getElementById('trackingModal').style.display = "flex";
window.setAuthMode = (m) => authMode = m;
window.logout = () => signOut(auth).then(() => location.reload());
window.handleAuth = async () => {
    const e = document.getElementById('auth-email').value;
    const p = document.getElementById('auth-pass').value;
    try {
        if(authMode==='login') await signInWithEmailAndPassword(auth, e, p);
        else await createUserWithEmailAndPassword(auth, e, p);
        location.reload();
    } catch(err) { alert(err.message); }
};

init();
import { db, auth } from './firebase-config.js';
import { 
    signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { 
    doc, getDoc, collection, onSnapshot, addDoc, query, where, setDoc, updateDoc, getDocs, orderBy 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ==========================================
// 1. GLOBAL VARIABLES & STATE
// ==========================================
const urlParams = new URLSearchParams(window.location.search);
const resId = urlParams.get('resId');
const tableNo = urlParams.get('table') || "01";

let cart = JSON.parse(localStorage.getItem(`platto_cart_${resId}`)) || [];
let restaurantData = {};
let selectedPaymentMode = "";
let orderType = "Pickup"; 
let isRedeeming = false;
let currentAuthMode = "login";
let userUID = "";
let userPoints = 0;
let currentItemToCustomize = null;
let couponDiscount = 0;
let appliedCouponCode = "";

const loader = document.getElementById('loader');

// Safety Helpers: UI Update
const setUI = (id, val) => { const el = document.getElementById(id); if(el) el.innerText = val; };
const showEl = (id, show = true) => { const el = document.getElementById(id); if(el) el.style.display = show ? "block" : "none"; };
const showFlex = (id, show = true) => { const el = document.getElementById(id); if(el) el.style.display = show ? "flex" : "none"; };

// ==========================================
// 2. INITIALIZATION (APP START)
// ==========================================
async function init() {
    if (!resId) {
        document.body.innerHTML = "<div style='text-align:center; padding:100px;'><h3>⚠️ Invalid QR Code. Scan again.</h3></div>";
        return;
    }

    const resSnap = await getDoc(doc(db, "restaurants", resId));
    if (resSnap.exists()) {
        restaurantData = resSnap.data();
        renderBranding();
        renderCategories(); // FIXED: Definition below
        handleAnnouncement();
    }

    onAuthStateChanged(auth, async (user) => {
        const navAuthBtn = document.getElementById('nav-auth-btn');
        const navProfileBtn = document.getElementById('nav-profile-btn');

        if (user) {
            userUID = user.uid;
            showEl('nav-auth-btn', false);
            showEl('nav-profile-btn');
            
            onSnapshot(doc(db, "users", userUID), (uSnap) => {
                if (uSnap.exists()) {
                    userPoints = uSnap.data().points || 0;
                    updatePointsUI();
                    if(document.getElementById('user-profile-name')) document.getElementById('user-profile-name').value = uSnap.data().name || "";
                    if(document.getElementById('user-profile-phone')) document.getElementById('user-profile-phone').value = uSnap.data().phone || "";
                    if(document.getElementById('cust-name-final')) document.getElementById('cust-name-final').value = uSnap.data().name || "";
                }
            });
        } else {
            userUID = localStorage.getItem('p_guest_id') || "g_" + Date.now();
            if(!localStorage.getItem('p_guest_id')) localStorage.setItem('p_guest_id', userUID);
            showEl('nav-auth-btn');
            showEl('nav-profile-btn', false);
        }
        loadMenu();
    });
    updateCartUI();
}

function renderBranding() {
    setUI('res-name-display', restaurantData.name);
    setUI('wait-time', restaurantData.prepTime || "20");
    setUI('res-about-text', restaurantData.about || "");
    setUI('tbl-no', tableNo);
    if(document.getElementById('res-logo') && restaurantData.logoUrl) document.getElementById('res-logo').src = restaurantData.logoUrl;
    
    if(restaurantData.wifiName) {
        showFlex('wifi-display');
        setUI('wifi-name', restaurantData.wifiName);
        setUI('wifi-pass', restaurantData.wifiPass);
    }
    if(document.getElementById('link-fb')) document.getElementById('link-fb').href = restaurantData.fbLink || "#";
    if(document.getElementById('link-ig')) document.getElementById('link-ig').href = restaurantData.igLink || "#";
    if(document.getElementById('link-yt')) document.getElementById('link-yt').href = restaurantData.ytLink || "#";
    if(document.getElementById('whatsapp-btn')) document.getElementById('whatsapp-btn').href = `https://wa.me/91${restaurantData.ownerPhone}`;
}

function renderCategories() {
    const list = document.getElementById('categories-list');
    if(restaurantData.categories && list) {
        list.innerHTML = `<button class="cat-pill active" onclick="window.filterByCategory('All', this)">All</button>`;
        restaurantData.categories.forEach(cat => {
            list.innerHTML += `<button class="cat-pill" onclick="window.filterByCategory('${cat}', this)">${cat}</button>`;
        });
    }
}

// ==========================================
// 3. MENU & CUSTOMIZATION (S/M/L)
// ==========================================
function loadMenu(category = 'All') {
    onSnapshot(collection(db, "restaurants", resId, "menu"), (snap) => {
        const grid = document.getElementById('menu-list');
        if(!grid) return; grid.innerHTML = "";
        const search = document.getElementById('menu-search') ? document.getElementById('menu-search').value.toLowerCase() : "";

        snap.forEach(d => {
            const item = d.data();
            if(category !== 'All' && item.category !== category) return;
            if(search && !item.name.toLowerCase().includes(search)) return;

            grid.innerHTML += `
                <div class="food-card" onclick='window.openCustomize("${d.id}", ${JSON.stringify(item)})'>
                    <img src="${item.imgUrl || 'https://via.placeholder.com/150'}" class="food-img">
                    <div class="food-info">
                        <h4>${item.name}</h4>
                        <b class="food-price">₹${item.price}</b>
                    </div>
                </div>`;
        });
        showEl('loader', false);
    });
}

window.openCustomize = (id, item) => {
    currentItemToCustomize = { ...item, id };
    document.getElementById('cust-item-name').innerText = item.name;
    
    // Map prices from Firestore (price, priceM, priceL)
    setUI('p-price-s', "₹" + item.price);
    setUI('p-price-m', item.priceM ? "₹" + item.priceM : "N/A");
    setUI('p-price-l', item.priceL ? "₹" + item.priceL : "N/A");

    const extrasDiv = document.getElementById('extras-options');
    if(extrasDiv) {
        extrasDiv.innerHTML = "";
        if(restaurantData.variants) {
            restaurantData.variants.forEach(v => {
                extrasDiv.innerHTML += `<label class="option-row">
                    <span><input type="checkbox" class="ex-item" value="${v.name}" data-price="${v.price}"> ${v.name}</span>
                    <b>+₹${v.price}</b>
                </label>`;
            });
        }
    }
    showFlex('customizeModal');
};

window.addCustomizedToCart = () => {
    const sizeInput = document.querySelector('input[name="p-size"]:checked');
    const size = sizeInput ? sizeInput.value : "Regular";
    
    let basePrice = parseInt(currentItemToCustomize.price);
    if(size === 'Medium' && currentItemToCustomize.priceM) basePrice = parseInt(currentItemToCustomize.priceM);
    if(size === 'Large' && currentItemToCustomize.priceL) basePrice = parseInt(currentItemToCustomize.priceL);
    
    document.querySelectorAll('.ex-item:checked').forEach(el => basePrice += parseInt(el.dataset.price));
    
    cart.push({ id: Date.now(), name: `${currentItemToCustomize.name} (${size})`, price: basePrice, qty: 1 });
    saveCart();
    window.closeModal('customizeModal');
};

// ==========================================
// 4. BASKET LOGIC (+/- & Coupon)
// ==========================================
function saveCart() {
    localStorage.setItem(`platto_cart_${resId}`, JSON.stringify(cart));
    updateCartUI();
}

function updateCartUI() {
    const totalQty = cart.reduce((s, i) => s + i.qty, 0);
    const totalAmt = cart.reduce((s, i) => s + (i.price * i.qty), 0);
    const bar = document.getElementById('cart-bar');
    if(cart.length > 0 && bar) {
        showFlex('cart-bar');
        setUI('cart-qty', totalQty + " Items");
        setUI('cart-total', totalAmt);
        if(document.getElementById('cart-badge-count')) document.getElementById('cart-badge-count').innerText = totalQty;
    } else if(bar) showEl('cart-bar', false);
}

window.changeQty = (index, delta) => {
    cart[index].qty = (cart[index].qty || 1) + delta;
    if(cart[index].qty <= 0) cart.splice(index, 1);
    if(appliedCouponCode) { couponDiscount = 0; appliedCouponCode = ""; setUI('coupon-msg', ""); }
    saveCart(); 
    window.renderCartList();
};

window.renderCartList = () => {
    const list = document.getElementById('cart-items-list');
    if(!list) return;
    list.innerHTML = cart.length === 0 ? "<p style='padding:20px;'>Basket is empty</p>" : "";
    let sub = 0;
    cart.forEach((item, index) => {
        const itemTotal = item.price * item.qty;
        sub += itemTotal;
        list.innerHTML += `
        <div class="cart-item">
            <div class="item-main-info"><b>${item.name}</b><small>₹${item.price}</small></div>
            <div class="qty-control-box">
                <button class="qty-btn-pro" onclick="window.changeQty(${index}, -1)">-</button>
                <span class="qty-count-text">${item.qty}</span>
                <button class="qty-btn-pro" onclick="window.changeQty(${index}, 1)">+</button>
            </div>
            <div style="font-weight:800; min-width:60px; text-align:right;">₹${itemTotal}</div>
        </div>`;
    });
    setUI('summary-subtotal', "₹" + sub);
    let totalPayable = sub - (isRedeeming ? 10 : 0) - couponDiscount;
    setUI('summary-total', "₹" + (totalPayable < 0 ? 0 : totalPayable));
    showFlex('discount-line', isRedeeming);
    showFlex('coupon-discount-line', couponDiscount > 0);
    setUI('coupon-discount-val', "-₹" + couponDiscount);
};

window.applyCoupon = async () => {
    const code = document.getElementById('coupon-code').value.trim().toUpperCase();
    if(!code) return alert("Enter Code");
    const subtotal = cart.reduce((s, i) => s + (i.price * i.qty), 0);
    try {
        const q = query(collection(db, "restaurants", resId, "coupons"), where("code", "==", code));
        const snap = await getDocs(q);
        if(!snap.empty) {
            const c = snap.docs[0].data();
            if(subtotal < c.minOrder) return alert(`Min order ₹${c.minOrder} required!`);
            couponDiscount = Math.min(Math.floor((subtotal * c.percent) / 100), c.maxDiscount);
            appliedCouponCode = code;
            setUI('coupon-msg', `🎉 Applied! ₹${couponDiscount} OFF`);
            window.renderCartList();
        } else alert("Invalid Coupon");
    } catch(e) { alert("Coupon Error"); }
};

// ==========================================
// 5. CHECKOUT & CONFIRM
// ==========================================
window.openCheckoutModal = () => {
    if(cart.length === 0) return alert("Basket empty!");
    window.closeModal('cartModal');
    showFlex('checkoutModal');
    const sub = cart.reduce((s, i) => s + (i.price * i.qty), 0);
    setUI('final-amt', (sub - (isRedeeming ? 10 : 0) - couponDiscount));
};

window.setOrderType = (type) => {
    orderType = type;
    const subtotal = cart.reduce((s, i) => s + (i.price * i.qty), 0);
    const minDlv = restaurantData.minOrder || 300;
    document.getElementById('type-pickup').classList.toggle('active', type === 'Pickup');
    document.getElementById('type-delivery').classList.toggle('active', type === 'Delivery');
    if(type === 'Delivery') {
        if(subtotal < minDlv) { alert(`Min ₹${minDlv} for delivery!`); window.setOrderType('Pickup'); return; }
        setUI('delivery-dynamic-msg', `⚠️ Delivery within ${restaurantData.maxKM || 3}KM (Min Order ₹${minDlv})`);
        showEl('delivery-address-box');
    } else showEl('delivery-address-box', false);
};

window.confirmOrder = async () => {
    const nameInput = document.getElementById('cust-name-final');
    if(!nameInput || !nameInput.value.trim()) return alert("Enter Name!");
    showEl('loader');
    const orderData = {
        resId, table: tableNo, customerName: nameInput.value, userUID, items: cart,
        total: document.getElementById('final-amt').innerText, status: "Pending", 
        paymentMode: selectedPaymentMode, orderType, timestamp: new Date(),
        instruction: document.getElementById('chef-note').value || "", 
        address: document.getElementById('cust-address') ? document.getElementById('cust-address').value : ""
    };
    try {
        await addDoc(collection(db, "orders"), orderData);
        showFlex('success-screen'); setUI('s-name', nameInput.value); setUI('s-table', tableNo);
        // Points Update
        const earned = Math.floor(parseInt(orderData.total)/10);
        let newPts = userPoints + earned; if(isRedeeming) newPts -= 1000;
        await setDoc(doc(db, "users", userUID), { points: newPts, name: nameInput.value }, { merge: true });
        localStorage.removeItem(`platto_cart_${resId}`); cart = [];
    } catch(e) { alert(e.message); }
    showEl('loader', false);
};

// ==========================================
// 6. TRACKING, HELPERS & AUTH
// ==========================================
window.openTrackingModal = () => {
    showFlex('trackingModal');
    const list = document.getElementById('live-tracking-list');
    onSnapshot(query(collection(db, "orders"), where("userUID", "==", userUID)), (snap) => {
        if(!list) return; list.innerHTML = "";
        let hasLive = false;
        snap.forEach(d => {
            const o = d.data();
            if(["Pending", "Preparing", "Ready"].includes(o.status)) {
                hasLive = true;
                list.innerHTML += `<div class="history-item" style="border-left:4px solid var(--primary); padding:10px; margin-bottom:10px; background:#fff;">
                    <span style="float:right; color:var(--primary); font-weight:800;">${o.status}</span>
                    <b>Table ${o.table}</b><br><small>₹${o.total}</small>
                </div>`;
            }
        });
        if(!hasLive) list.innerHTML = "<p>No active orders.</p>";
    });
};

window.openHistoryModal = async () => {
    showFlex('historyModal');
    const list = document.getElementById('history-items-list');
    if(!list) return; list.innerHTML = "Loading...";
    const q = query(collection(db, "orders"), where("userUID", "==", userUID), orderBy("timestamp", "desc"));
    const snap = await getDocs(q);
    list.innerHTML = snap.empty ? "<p>No past orders.</p>" : "";
    snap.forEach(d => {
        const o = d.data();
        if(o.status === "Picked Up" || o.status === "Rejected") {
            list.innerHTML += `<div class="history-item"><b>${o.timestamp.toDate().toLocaleDateString('en-GB')}</b> - ₹${o.total} [${o.status}]</div>`;
        }
    });
};

window.updatePointsUI = () => {
    setUI('user-pts', userPoints);
    setUI('profile-pts-display', userPoints);
    const btn = document.getElementById('redeem-btn');
    if(btn) btn.disabled = userPoints < 1000;
};

window.setPayMode = (mode) => {
    selectedPaymentMode = mode;
    document.getElementById('mode-online').classList.toggle('selected', mode === 'Online');
    document.getElementById('mode-cash').classList.toggle('selected', mode === 'Cash');
    if(mode === 'Online') {
        showEl('payment-qr-area');
        const qrDiv = document.getElementById('checkout-payment-qr'); qrDiv.innerHTML = "";
        new QRCode(qrDiv, { text: `upi://pay?pa=${restaurantData.upiId}&am=${document.getElementById('final-amt').innerText}`, width: 140, height: 140 });
        setUI('final-upi-id', restaurantData.upiId);
    } else showEl('payment-qr-area', false);
    document.getElementById('final-place-btn').disabled = false;
};

window.filterByCategory = (cat, btn) => {
    document.querySelectorAll('.cat-pill').forEach(b => b.classList.remove('active'));
    if(btn) btn.classList.add('active'); loadMenu(cat);
};

window.handleAuth = async () => {
    const e = document.getElementById('auth-email').value;
    const p = document.getElementById('auth-pass').value;
    try {
        if(currentAuthMode === 'login') await signInWithEmailAndPassword(auth, e, p);
        else await createUserWithEmailAndPassword(auth, e, p);
        window.closeModal('authModal');
    } catch(err) { alert(err.message); }
};

function handleAnnouncement() {
    if(restaurantData.activeAnnouncement) {
        showFlex('announcement-modal');
        setUI('ann-title', restaurantData.annTitle); setUI('ann-desc', restaurantData.annText);
    }
}

window.closeModal = (id) => showEl(id, false);
window.openAuthModal = () => showFlex('authModal');
window.openProfileModal = () => showFlex('profileModal');
window.logout = () => signOut(auth).then(() => location.reload());
window.setAuthMode = (m) => { currentAuthMode = m; document.getElementById('tab-login').classList.toggle('active', m==='login'); document.getElementById('tab-signup').classList.toggle('active', m==='signup'); };
window.redeemPoints = () => { isRedeeming = true; alert("Reward Applied!"); window.openCartModal(); };
window.filterMenu = () => loadMenu();

init();
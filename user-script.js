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
let couponDiscount = 0;
let appliedCouponCode = "";
let currentAuthMode = "login";
let userUID = "";
let userPoints = 0;
let currentItemToCustomize = null;

const loader = document.getElementById('loader');

// Safety Helpers (Prevents White Screen)
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
        renderCategories();
        handleAnnouncement();
    }

    onAuthStateChanged(auth, async (user) => {
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

// ==========================================
// 3. BRANDING, SOCIALS & WIFI
// ==========================================
function renderBranding() {
    setUI('res-name-display', restaurantData.name);
    setUI('wait-time', restaurantData.prepTime || "20");
    setUI('res-about-text', restaurantData.about || "");
    setUI('tbl-no', tableNo);
    if(document.getElementById('res-logo') && restaurantData.logoUrl) document.getElementById('res-logo').src = restaurantData.logoUrl;
    if(document.getElementById('hero-banner-img') && restaurantData.bannerUrl) document.getElementById('hero-banner-img').src = restaurantData.bannerUrl;

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
// 4. MENU & CUSTOMIZATION (S/M/L logic)
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

            const hasSizes = (item.priceM > 0 || item.priceL > 0);
            const clickAction = hasSizes 
                ? `window.openCustomize("${d.id}", ${JSON.stringify(item).replace(/'/g, "&apos;")})`
                : `window.addToCart("${item.name}", ${item.price})`;

            grid.innerHTML += `
                <div class="food-card" onclick='${clickAction}'>
                    <img src="${item.imgUrl || 'https://via.placeholder.com/150'}" class="food-img">
                    <div class="food-info">
                        <h4>${item.name}</h4>
                        <b class="food-price">₹${item.price}${hasSizes ? ' +' : ''}</b>
                        <button class="add-btn" style="width:100%; margin-top:8px;">ADD +</button>
                    </div>
                </div>`;
        });
        showEl('loader', false);
    });
}

window.openCustomize = (id, item) => {
    currentItemToCustomize = { ...item, id };
    setUI('cust-item-name', item.name);
    
    // Size Options generation (Logic Fix)
    const sizeBox = document.getElementById('size-options');
    if(sizeBox) {
        let html = `<label class="option-row"><input type="radio" name="p-size" value="Regular" checked> Regular <span>₹${item.price}</span></label>`;
        if(item.priceM) html += `<label class="option-row"><input type="radio" name="p-size" value="Medium"> Medium <span>₹${item.priceM}</span></label>`;
        if(item.priceL) html += `<label class="option-row"><input type="radio" name="p-size" value="Large"> Large <span>₹${item.priceL}</span></label>`;
        sizeBox.innerHTML = html;
    }

    // Ingredients Display
    const extrasDiv = document.getElementById('extras-options');
    if(extrasDiv) {
        extrasDiv.innerHTML = item.ingredients ? `<p style="font-size:0.8rem; color:gray; margin-bottom:10px;">📝 ${item.ingredients}</p>` : "";
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
    let price = parseInt(currentItemToCustomize.price);
    if(size === 'Medium') price = parseInt(currentItemToCustomize.priceM) || (price + 50);
    if(size === 'Large') price = parseInt(currentItemToCustomize.priceL) || (price + 100);
    
    document.querySelectorAll('.ex-item:checked').forEach(el => price += parseInt(el.dataset.price));
    cart.push({ id: Date.now(), name: `${currentItemToCustomize.name} (${size})`, price, qty: 1 });
    saveCart();
    window.closeModal('customizeModal');
};

// ==========================================
// 5. BASKET & QUANTITY Logic
// ==========================================
function saveCart() {
    localStorage.setItem(`platto_cart_${resId}`, JSON.stringify(cart));
    updateCartUI();
}

function updateCartUI() {
    const totalQty = cart.reduce((s, i) => s + (i.qty || 1), 0);
    const totalAmt = cart.reduce((s, i) => s + (i.price * (i.qty || 1)), 0);
    const bar = document.getElementById('cart-bar');
    if(cart.length > 0 && bar) {
        showFlex('cart-bar');
        setUI('cart-qty', totalQty + " Items");
        setUI('cart-total', totalAmt);
        if(document.getElementById('cart-badge-count')) document.getElementById('cart-badge-count').innerText = totalQty;
    } else if(bar) showEl('cart-bar', false);
}

window.renderCartList = () => {
    const list = document.getElementById('cart-items-list');
    if (!list) return;
    list.innerHTML = cart.length === 0 ? "<div style='padding:40px; color:gray;'>Basket is empty</div>" : "";
    let sub = 0;
    cart.forEach((item, index) => {
        const total = item.price * item.qty;
        sub += total;
        list.innerHTML += `
        <div class="cart-item">
            <div class="item-main-info"><b>${item.name}</b><small>₹${item.price}</small></div>
            <div class="qty-control-box">
                <button class="qty-btn-pro" onclick="window.changeQty(${index}, -1)">-</button>
                <span class="qty-count-text">${item.qty}</span>
                <button class="qty-btn-pro" onclick="window.changeQty(${index}, 1)">+</button>
            </div>
            <div style="font-weight:800; min-width:60px; text-align:right;">₹${total}</div>
        </div>`;
    });
    setUI('summary-subtotal', "₹" + sub);
    setUI('available-pts', userPoints);
    showEl('redeem-section', (userPoints >= 1000 && cart.length > 0));
    let totalFinal = sub - (isRedeeming ? 10 : 0) - couponDiscount;
    setUI('summary-total', "₹" + (totalFinal < 0 ? 0 : totalFinal));
    showFlex('discount-line', isRedeeming);
    showFlex('coupon-discount-line', couponDiscount > 0);
    setUI('coupon-discount-val', "-₹" + couponDiscount);
};

window.changeQty = (index, delta) => {
    cart[index].qty = (cart[index].qty || 1) + delta;
    if (cart[index].qty <= 0) cart.splice(index, 1);
    if (appliedCouponCode) { couponDiscount = 0; appliedCouponCode = ""; setUI('coupon-msg', ""); }
    saveCart(); window.renderCartList();
};

window.applyCoupon = async () => {
    const code = document.getElementById('coupon-code').value.trim().toUpperCase();
    if (!code) return alert("Enter Code");
    const subtotal = cart.reduce((s, i) => s + (i.price * i.qty), 0);
    try {
        const q = query(collection(db, "restaurants", resId, "coupons"), where("code", "==", code));
        const snap = await getDocs(q);
        if (!snap.empty) {
            const c = snap.docs[0].data();
            if (subtotal < c.minOrder) return alert(`Min order ₹${c.minOrder} required!`);
            couponDiscount = Math.min(Math.floor((subtotal * c.percent) / 100), c.maxDiscount);
            appliedCouponCode = code;
            setUI('coupon-msg', `🎉 Applied! ₹${couponDiscount} OFF`);
            window.renderCartList();
        } else alert("Invalid Coupon");
    } catch(e) { alert("Coupon Error"); }
};

// ==========================================
// 5. CHECKOUT & ORDERS
// ==========================================
window.openCheckoutModal = () => {
    window.closeModal('cartModal');
    showFlex('checkoutModal');
    const sub = cart.reduce((s, i) => s + (i.price * i.qty), 0);
    setUI('final-amt', (sub - (isRedeeming ? 10 : 0) - couponDiscount));
};

window.setOrderType = (type) => {
    orderType = type;
    const subtotal = cart.reduce((s, i) => s + (i.price * i.qty), 0);
    const minDlv = parseInt(restaurantData.minOrder) || 0;
    if(document.getElementById('type-pickup')) document.getElementById('type-pickup').classList.toggle('active', type === 'Pickup');
    if(document.getElementById('type-delivery')) document.getElementById('type-delivery').classList.toggle('active', type === 'Delivery');
    if(type === 'Delivery') {
        if(subtotal < minDlv) { alert(`Min ₹${minDlv} for delivery!`); window.setOrderType('Pickup'); return; }
        showEl('delivery-address-box');
    } else showEl('delivery-address-box', false);
};

window.setPayMode = (mode) => {
    selectedPaymentMode = mode;
    if(document.getElementById('mode-online')) document.getElementById('mode-online').classList.toggle('selected', mode === 'Online');
    if(document.getElementById('mode-cash')) document.getElementById('mode-cash').classList.toggle('selected', mode === 'Cash');
    if(mode === 'Online') {
        showEl('payment-qr-area');
        const qrDiv = document.getElementById('checkout-payment-qr'); qrDiv.innerHTML = "";
        const amt = document.getElementById('final-amt').innerText;
        new QRCode(qrDiv, { text: `upi://pay?pa=${restaurantData.upiId}&am=${amt}`, width: 140, height: 140 });
        setUI('final-upi-id', restaurantData.upiId);
    } else showEl('payment-qr-area', false);
    if(document.getElementById('final-place-btn')) document.getElementById('final-place-btn').disabled = false;
};

window.confirmOrder = async () => {
    const nameInput = document.getElementById('cust-name-final');
    if(!nameInput || !nameInput.value.trim()) return alert("Enter Name!");
    showEl('loader');
    const finalBill = document.getElementById('final-amt').innerText;
    const orderData = {
        resId, table: tableNo, customerName: nameInput.value, userUID, items: cart,
        total: finalBill, status: "Pending", paymentMode: selectedPaymentMode,
        orderType, timestamp: new Date(), instruction: document.getElementById('chef-note').value || "",
        address: document.getElementById('cust-address') ? document.getElementById('cust-address').value : "At Table"
    };

    try {
        await addDoc(collection(db, "orders"), orderData);
        window.closeModal('checkoutModal');
        showFlex('success-screen');
        setUI('s-name', nameInput.value); setUI('s-table', tableNo);
        
        const earned = Math.floor(parseInt(finalBill)/100)*10;
        const userRef = doc(db, "users", userUID);
        const uSnap = await getDoc(userRef);
        let pts = uSnap.exists() ? uSnap.data().points : 0;
        if(isRedeeming) pts -= 1000;
        await setDoc(userRef, { points: pts + earned, name: nameInput.value }, { merge: true });
        localStorage.removeItem(`platto_cart_${resId}`); cart = []; updateCartUI();
    } catch(e) { alert(e.message); }
    showEl('loader', false);
};

// ==========================================
// 6. HISTORY & UTILS
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
    list.innerHTML = snap.empty ? "<p>No orders yet.</p>" : "";
    snap.forEach(d => {
        const o = d.data();
        if(["Picked Up", "Rejected"].includes(o.status)) {
            const date = o.timestamp ? o.timestamp.toDate().toLocaleDateString('en-GB') : "Old";
            list.innerHTML += `<div class="history-item"><b>${date}</b> - ₹${o.total} [${o.status}]</div>`;
        }
    });
};

function updatePointsUI() {
    setUI('user-pts', userPoints);
    setUI('profile-pts-display', userPoints);
    const btn = document.getElementById('redeem-btn');
    if(btn) btn.disabled = userPoints < 1000;
}

window.handleAuth = async () => {
    const e = document.getElementById('auth-email').value;
    const p = document.getElementById('auth-pass').value;
    try {
        if(currentAuthMode === 'login') await signInWithEmailAndPassword(auth, e, p);
        else await createUserWithEmailAndPassword(auth, e, p);
        window.closeModal('authModal');
    } catch(err) { alert(err.message); }
};

window.saveUserProfile = async () => {
    const n = document.getElementById('user-profile-name').value;
    const ph = document.getElementById('user-profile-phone').value;
    await setDoc(doc(db, "users", userUID), { name: n, phone: ph }, { merge: true });
    alert("Saved!"); window.closeModal('profileModal');
};

function handleAnnouncement() {
    if(restaurantData.activeAnnouncement) {
        showFlex('announcement-modal');
        setUI('ann-title', restaurantData.annTitle); setUI('ann-desc', restaurantData.annText);
    }
}

window.addToCart = (name, price) => {
    const index = cart.findIndex(i => i.name === name);
    if(index > -1) cart[index].qty++;
    else cart.push({ id: Date.now(), name, price: parseInt(price), qty: 1 });
    saveCart();
};

window.filterByCategory = (cat, btn) => {
    document.querySelectorAll('.cat-pill').forEach(b => b.classList.remove('active'));
    if(btn) btn.classList.add('active'); loadMenu(cat);
};
window.closeModal = (id) => showEl(id, false);
window.openAuthModal = () => showFlex('authModal');
window.openProfileModal = () => showFlex('profileModal');
window.openCartModal = () => { showFlex('cartModal'); window.renderCartList(); };
window.logout = () => signOut(auth).then(() => location.reload());
window.setAuthMode = (m) => currentAuthMode = m;
window.redeemPoints = () => { isRedeeming = true; alert("Reward Applied!"); window.openCartModal(); };
window.filterMenu = () => loadMenu();
window.openSupportModal = () => showFlex('supportModal');
window.submitSupportTicket = async () => {
    const queryTxt = document.getElementById('support-query').value;
    if(!queryTxt) return;
    await addDoc(collection(db, "tickets"), { resId, userUID, query: queryTxt, time: new Date() });
    alert("Ticket raised!"); window.closeModal('supportModal');
};

init();
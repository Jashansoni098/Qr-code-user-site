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

    // Fetch Restaurant Settings
    const resSnap = await getDoc(doc(db, "restaurants", resId));
    if (resSnap.exists()) {
        restaurantData = resSnap.data();
        renderBranding();
        renderCategories();
        handleAnnouncement();
    }

    // Auth & Loyalty Sync
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
        checkLiveOrders(); 
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
// 3. MENU & CUSTOMIZATION (S/M/L) - FIXED EMPTY MODAL
// ==========================================
function loadMenu(category = 'All') {
    onSnapshot(collection(db, "restaurants", resId, "menu"), (snap) => {
        const grid = document.getElementById('menu-list');
        if(!grid) return;
        grid.innerHTML = "";
        const searchInput = document.getElementById('menu-search');
        const search = searchInput ? searchInput.value.toLowerCase() : "";

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
    
    // Size Logic Fix
    setUI('p-price-s', "₹" + item.price);
    setUI('p-price-m', item.priceM ? "₹" + item.priceM : "₹" + (parseInt(item.price) + 50));
    setUI('p-price-l', item.priceL ? "₹" + item.priceL : "₹" + (parseInt(item.price) + 100));

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
    
    let price = parseInt(currentItemToCustomize.price);
    if(size === 'Medium') price = parseInt(currentItemToCustomize.priceM) || (price + 50);
    if(size === 'Large') price = parseInt(currentItemToCustomize.priceL) || (price + 100);
    
    document.querySelectorAll('.ex-item:checked').forEach(el => price += parseInt(el.dataset.price));
    
    cart.push({ id: Date.now(), name: `${currentItemToCustomize.name} (${size})`, price, qty: 1 });
    saveCart();
    window.closeModal('customizeModal');
};

// ==========================================
// 4. BASKET LOGIC (Quantity +/- & Coupon)
// ==========================================
function saveCart() {
    localStorage.setItem(`platto_cart_${resId}`, JSON.stringify(cart));
    updateCartUI();
}

function updateCartUI() {
    const totalQty = cart.reduce((s, i) => s + (i.qty || 1), 0);
    const totalAmt = cart.reduce((s, i) => s + (i.price * i.qty), 0);
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
    list.innerHTML = cart.length === 0 ? "<div style='padding:40px; color:gray;'>Empty Basket</div>" : "";
    
    let subtotal = 0;
    cart.forEach((item, index) => {
        const itemTotal = item.price * item.qty;
        subtotal += itemTotal;
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

    setUI('summary-subtotal', "₹" + subtotal);
    setUI('available-pts', userPoints);
    showEl('redeem-section', (userPoints >= 1000 && cart.length > 0));

    let finalTotal = subtotal;
    if (isRedeeming) finalTotal -= 10;
    finalTotal -= couponDiscount;

    setUI('summary-total', "₹" + (finalTotal < 0 ? 0 : finalTotal));
    showFlex('discount-line', isRedeeming);
    showFlex('coupon-discount-line', couponDiscount > 0);
    setUI('coupon-discount-val', "-₹" + couponDiscount);
};

window.changeQty = (index, delta) => {
    cart[index].qty = (cart[index].qty || 1) + delta;
    if (cart[index].qty <= 0) cart.splice(index, 1);
    if (appliedCouponCode) { couponDiscount = 0; appliedCouponCode = ""; setUI('coupon-msg', ""); }
    saveCart(); 
    window.renderCartList();
};

window.applyCoupon = async () => {
    const code = document.getElementById('coupon-code').value.trim().toUpperCase();
    if (!code) return alert("Enter Code");
    const subtotal = cart.reduce((s, i) => s + (i.price * i.qty), 0);

    try {
        const q = query(collection(db, "restaurants", resId, "coupons"), where("code", "==", code));
        const snap = await getDocs(q);
        if (!snap.empty) {
            const cData = snap.docs[0].data();
            if (subtotal < cData.minOrder) return alert(`Min order ₹${cData.minOrder} required!`);
            couponDiscount = Math.min(Math.floor((subtotal * cData.percent) / 100), cData.maxDiscount);
            appliedCouponCode = code;
            setUI('coupon-msg', `🎉 Applied! ₹${couponDiscount} OFF`);
            window.renderCartList();
        } else alert("Invalid Coupon");
    } catch (e) { alert("Error applying coupon."); }
};

// ==========================================
// 5. CHECKOUT & ORDERING
// ==========================================
window.openCheckoutModal = () => {
    if(cart.length === 0) return alert("Basket empty!");
    window.closeModal('cartModal');
    showFlex('checkoutModal');
    const sub = cart.reduce((s, i) => s + (i.price * i.qty), 0);
    const final = sub - (isRedeeming ? 10 : 0) - couponDiscount;
    setUI('final-amt', (final < 0 ? 0 : final));
};

window.setOrderType = (type) => {
    console.log("Selected Order Type:", type);
    orderType = type;

    // 1. Buttons ko dhoondhen
    const btnP = document.getElementById('type-pickup');
    const btnD = document.getElementById('type-delivery');
    const delBox = document.getElementById('delivery-address-box');
    const delMsg = document.getElementById('delivery-dynamic-msg');

    // 2. Active Class Toggle karein
    if(btnP) btnP.classList.toggle('active', type === 'Pickup');
    if(btnD) btnD.classList.toggle('active', type === 'Delivery');

    if(type === 'Delivery') {
        // 3. Subtotal calculate karein
        const subtotal = cart.reduce((s, i) => s + (i.price * (i.qty || 1)), 0);
        
        // 4. Owner ki settings check karein (Agar settings nahi mili toh 0 aur 3KM default)
        const minOrder = parseInt(restaurantData.minOrder) || 0;
        const km = restaurantData.maxKM || 3;

        if(subtotal < minOrder) {
            alert(`Oops! Delivery ke liye kam se kam ₹${minOrder} ka order hona zaroori hai.\nAbhi aapka total ₹${subtotal} hai.`);
            window.setOrderType('Pickup'); // Wapas pickup par bhejein
            return;
        }

        // 5. Address Box dikhayein
        if(delBox) delBox.style.display = "block";
        if(delMsg) delMsg.innerText = `✅ Delivery area: ${km}KM ke andar | Min Order: ₹${minOrder}`;
    } else {
        // Pickup select kiya toh address box chhupayein
        if(delBox) delBox.style.display = "none";
    }
};

window.setPayMode = (mode) => {
    selectedPaymentMode = mode;
    document.getElementById('mode-online').classList.toggle('selected', mode === 'Online');
    document.getElementById('mode-cash').classList.toggle('selected', mode === 'Cash');
    if(mode === 'Online') {
        showEl('payment-qr-area');
        const qrDiv = document.getElementById('checkout-payment-qr'); qrDiv.innerHTML = "";
        const amt = document.getElementById('final-amt').innerText;
        new QRCode(qrDiv, { text: `upi://pay?pa=${restaurantData.upiId}&am=${amt}`, width: 140, height: 140 });
        setUI('final-upi-id', restaurantData.upiId);
    } else showEl('payment-qr-area', false);
    document.getElementById('final-place-btn').disabled = false;
};

window.confirmOrder = async () => {
    const nameEl = document.getElementById('cust-name-final');
    if(!nameEl || !nameEl.value.trim()) return alert("Enter Name!");
    showEl('loader');
    const finalBill = document.getElementById('final-amt').innerText;
    const orderData = {
        resId, table: tableNo, customerName: nameEl.value, userUID, items: cart,
        total: finalBill, status: "Pending", paymentMode: selectedPaymentMode,
        orderType, timestamp: new Date(), instruction: document.getElementById('chef-note').value || "",
        address: document.getElementById('cust-address') ? document.getElementById('cust-address').value : ""
    };

    try {
        await addDoc(collection(db, "orders"), orderData);
        showFlex('success-screen'); setUI('s-name', nameEl.value); setUI('s-table', tableNo);
        // Points Update
        const earned = Math.floor(parseInt(finalBill)/10);
        let newPts = userPoints + earned; if(isRedeeming) newPts -= 1000;
        await setDoc(doc(db, "users", userUID), { points: newPts, name: nameEl.value }, { merge: true });
        localStorage.removeItem(`platto_cart_${resId}`); cart = []; updateCartUI();
    } catch(e) { alert(e.message); }
    showEl('loader', false);
};

// ==========================================
// 6. TRACKING & HISTORY
// ==========================================
window.openTrackingModal = () => {
    showFlex('trackingModal');
    const list = document.getElementById('live-tracking-list');
    onSnapshot(query(collection(db, "orders"), where("userUID", "==", userUID)), (snap) => {
        if(!list) return; list.innerHTML = "";
        let hasLive = false;
        snap.forEach(d => {
            const o = d.data();
            if(!["Picked Up", "Rejected", "Done"].includes(o.status)) {
                hasLive = true;
                list.innerHTML += `<div class="history-item" style="border-left:4px solid var(--primary); padding:10px; margin-bottom:10px; background:#fff; text-align:left;">
                    <span style="float:right; color:var(--primary); font-weight:800;">${o.status}</span>
                    <b>Table ${o.table}</b><br><small>₹${o.total}</small>
                </div>`;
            }
        });
        if(!hasLive) list.innerHTML = "<p style='padding:20px;'>No active orders.</p>";
    });
};

window.openHistoryModal = async () => {
    showFlex('historyModal');
    const list = document.getElementById('history-items-list');
    if(!list) return;
    list.innerHTML = "Loading history...";
    const q = query(collection(db, "orders"), where("userUID", "==", userUID), orderBy("timestamp", "desc"));
    const snap = await getDocs(q);
    list.innerHTML = snap.empty ? "<p style='padding:20px;'>No past orders.</p>" : "";
    snap.forEach(d => {
        const o = d.data();
        if(o.status === "Picked Up" || o.status === "Rejected") {
            const date = o.timestamp ? o.timestamp.toDate().toLocaleDateString('en-GB') : "Old";
            list.innerHTML += `<div class="history-item"><b>${date}</b> - ₹${o.total} [${o.status}]</div>`;
        }
    });
};

// ==========================================
// 7. OTHERS (AUTH, REDEEM, UI)
// ==========================================
function updatePointsUI() {
    setUI('user-pts', userPoints);
    setUI('profile-pts-display', userPoints);
    setUI('available-pts', userPoints);
    const redeemBtn = document.getElementById('redeem-btn');
    if(redeemBtn) redeemBtn.disabled = userPoints < 1000;
}

window.redeemPoints = () => { isRedeeming = true; alert("Reward Applied!"); window.openCartModal(); };
window.setAuthMode = (m) => {
    currentAuthMode = m;
    document.getElementById('tab-login').classList.toggle('active', m === 'login');
    document.getElementById('tab-signup').classList.toggle('active', m === 'signup');
};
window.handleAuth = async () => {
    const e = document.getElementById('auth-email').value;
    const p = document.getElementById('auth-pass').value;
    try {
        if(currentAuthMode === 'login') await signInWithEmailAndPassword(auth, e, p);
        else await createUserWithEmailAndPassword(auth, e, p);
        window.closeAuthModal();
    } catch(err) { alert(err.message); }
};

window.saveUserProfile = async () => {
    const n = document.getElementById('user-profile-name').value;
    const ph = document.getElementById('user-profile-phone').value;
    await setDoc(doc(db, "users", userUID), { name: n, phone: ph }, { merge: true });
    alert("Profile Saved!"); window.closeModal('profileModal');
};

function handleAnnouncement() {
    if(restaurantData.activeAnnouncement) {
        showFlex('announcement-modal');
        setUI('ann-title', restaurantData.annTitle); setUI('ann-desc', restaurantData.annText);
    }
}

window.filterByCategory = (cat, btn) => {
    document.querySelectorAll('.cat-pill').forEach(b => b.classList.remove('active'));
    if(btn) btn.classList.add('active');
    loadMenu(cat);
};

window.closeModal = (id) => showEl(id, false);
window.openAuthModal = () => showFlex('authModal');
window.openProfileModal = () => showFlex('profileModal');
window.openCartModal = () => { showFlex('cartModal'); window.renderCartList(); };
window.logout = () => signOut(auth).then(() => location.reload());
window.filterMenu = () => loadMenu();
window.openTracking = () => window.openTrackingModal();
window.closeTracking = () => window.closeModal('trackingModal');
window.openSupportModal = () => showFlex('supportModal');
window.submitSupportTicket = async () => {
    const queryTxt = document.getElementById('support-query').value;
    if(!queryTxt) return;
    await addDoc(collection(db, "tickets"), { resId, userUID, query: queryTxt, time: new Date() });
    alert("Ticket raised!"); window.closeModal('supportModal');
};

init();
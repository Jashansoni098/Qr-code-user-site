import { db, auth } from './firebase-config.js';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, getDoc, collection, onSnapshot, addDoc, query, where, setDoc, updateDoc, getDocs, orderBy } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const urlParams = new URLSearchParams(window.location.search);
const resId = urlParams.get('resId');
const tableNo = urlParams.get('table') || "01";

let cart = JSON.parse(localStorage.getItem(`pl_cart_${resId}`)) || [];
let restaurantData = {};
let selectedPaymentMode = "";
let isRedeeming = false;
let userUID = "";
let userPoints = 0;
let couponDiscount = 0;
let appliedCouponCode = "";

const setUI = (id, val) => { const el = document.getElementById(id); if(el) el.innerText = val; };

// ==========================================
// 1. BASKET & QUANTITY Logic (Fixed +/-)
// ==========================================
window.changeQty = (index, delta) => {
    cart[index].qty = (cart[index].qty || 1) + delta;
    if(cart[index].qty <= 0) cart.splice(index, 1);
    
    // Reset coupon if items change
    if(appliedCouponCode) {
        couponDiscount = 0;
        appliedCouponCode = "";
        if(document.getElementById('coupon-msg')) document.getElementById('coupon-msg').innerText = "";
    }
    
    localStorage.setItem(`pl_cart_${resId}`, JSON.stringify(cart));
    updateCartUI(); 
    window.renderCartList();
};

window.renderCartList = () => {
    const list = document.getElementById('cart-items-list');
    if(!list) return;
    list.innerHTML = cart.length === 0 ? "<p style='padding:20px;'>Basket is empty</p>" : "";
    let sub = 0;
    
    cart.forEach((item, index) => {
        const itemTotal = item.price * (item.qty || 1);
        sub += itemTotal;
        list.innerHTML += `
        <div class="cart-item">
            <div class="item-main-info"><b>${item.name}</b><br><small>₹${item.price}</small></div>
            <div class="qty-control-box">
                <button class="qty-btn-pro" onclick="window.changeQty(${index}, -1)">-</button>
                <span class="qty-count-text">${item.qty || 1}</span>
                <button class="qty-btn-pro" onclick="window.changeQty(${index}, 1)">+</button>
            </div>
            <div style="font-weight:800; min-width:60px; text-align:right;">₹${itemTotal}</div>
        </div>`;
    });

    setUI('summary-subtotal', "₹" + sub);
    setUI('available-pts', userPoints);
    
    let total = sub - (isRedeeming ? 10 : 0) - couponDiscount;
    setUI('summary-total', "₹" + (total < 0 ? 0 : total));
    
    if(document.getElementById('coupon-discount-line')) {
        document.getElementById('coupon-discount-line').style.display = couponDiscount > 0 ? "flex" : "none";
        document.getElementById('coupon-discount-val').innerText = "-₹" + couponDiscount;
    }
};

// ==========================================
// 2. APPLY COUPON LOGIC
// ==========================================
window.applyCoupon = async () => {
    const code = document.getElementById('coupon-code').value.trim().toUpperCase();
    if(!code) return alert("Please enter code");
    
    const subtotal = cart.reduce((s, i) => s + (i.price * i.qty), 0);
    
    try {
        const q = query(collection(db, "restaurants", resId, "coupons"), where("code", "==", code));
        const snap = await getDocs(q);
        
        if(!snap.empty) {
            const c = snap.docs[0].data();
            if(subtotal < c.minOrder) return alert(`Minimum order ₹${c.minOrder} required!`);
            
            couponDiscount = Math.min(Math.floor((subtotal * c.percent) / 100), c.maxDiscount);
            appliedCouponCode = code;
            
            document.getElementById('coupon-msg').innerText = `🎉 Success! ₹${couponDiscount} OFF`;
            window.renderCartList();
        } else {
            alert("Invalid Coupon Code");
        }
    } catch(e) { alert("Error applying coupon"); }
};

// ==========================================
// 3. OTHER HELPER UPDATES
// ==========================================
function updateCartUI() {
    const totalQty = cart.reduce((s, i) => s + (i.qty || 1), 0);
    const totalAmt = cart.reduce((s, i) => s + (i.price * i.qty), 0);
    setUI('cart-badge-count', totalQty);
    setUI('cart-total', totalAmt);
}

window.addToCart = (name, price) => {
    const index = cart.findIndex(i => i.name === name);
    if(index > -1) cart[index].qty++;
    else cart.push({ id: Date.now(), name, price: parseInt(price), qty: 1 });
    saveCart();
};

function saveCart() {
    localStorage.setItem(`pl_cart_${resId}`, JSON.stringify(cart));
    updateCartUI();
}

window.openCheckoutModal = () => {
    if(cart.length === 0) return alert("Basket empty!");
    window.closeModal('cartModal');
    document.getElementById('checkoutModal').style.display = "flex";
    const sub = cart.reduce((s, i) => s + (i.price * i.qty), 0);
    const final = sub - (isRedeeming ? 10 : 0) - couponDiscount;
    setUI('final-amt', final < 0 ? 0 : final);
};


// ==========================================
// 3. INITIALIZATION & AUTH
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
                    const profName = document.getElementById('user-profile-name');
                    const profPhone = document.getElementById('user-profile-phone');
                    const custName = document.getElementById('cust-name-final');
                    if(profName) profName.value = uSnap.data().name || "";
                    if(profPhone) profPhone.value = uSnap.data().phone || "";
                    if(custName) custName.value = uSnap.data().name || "";
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
// 4. PROFESSIONAL BASKET & COUPON
// ==========================================
window.renderCartList = () => {
    const list = document.getElementById('cart-items-list');
    if (!list) return;
    list.innerHTML = cart.length === 0 ? "<div style='padding:40px; color:gray;'>Empty Basket</div>" : "";
    
    let subtotal = 0;
    cart.forEach((item, index) => {
        const itemTotal = item.price * (item.qty || 1);
        subtotal += itemTotal;
        list.innerHTML += `
        <div class="cart-item">
            <div class="item-info-box"><b>${item.name}</b><small>₹${item.price}</small></div>
            <div class="qty-wrapper">
                <button class="qty-btn-basket" onclick="window.changeQty(${index}, -1)">-</button>
                <span class="qty-number">${item.qty}</span>
                <button class="qty-btn-basket" onclick="window.changeQty(${index}, 1)">+</button>
            </div>
            <div class="item-total-price">₹${itemTotal}</div>
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
            alert(`🎉 ₹${couponDiscount} discount applied!`);
            window.renderCartList();
        } else alert("Invalid Coupon!");
    } catch (e) { alert("Error applying coupon."); }
};

window.redeemPoints = () => {
    isRedeeming = true;
    alert("₹10 Reward Applied!");
    window.renderCartList();
};

// ==========================================
// 5. CHECKOUT & PAYMENT FIX
// ==========================================
window.openCheckoutModal = () => {
    if(cart.length === 0) return alert("Basket empty!");
    window.closeModal('cartModal');
    showFlex('checkoutModal');
    const sub = cart.reduce((s, i) => s + (i.price * i.qty), 0);
    let final = sub - (isRedeeming ? 10 : 0) - couponDiscount;
    setUI('final-amt', final < 0 ? 0 : final);
};

window.setPayMode = (mode) => {
    selectedPaymentMode = mode;
    const btnO = document.getElementById('mode-online');
    const btnC = document.getElementById('mode-cash');
    if(btnO) btnO.classList.toggle('selected', mode === 'Online');
    if(btnC) btnC.classList.toggle('selected', mode === 'Cash');

    const qrArea = document.getElementById('payment-qr-area');
    if(mode === 'Online') {
        if(qrArea) qrArea.style.display = "block";
        const qrDiv = document.getElementById('checkout-payment-qr'); 
        if(qrDiv) {
            qrDiv.innerHTML = "";
            const amt = document.getElementById('final-amt').innerText;
            new QRCode(qrDiv, { text: `upi://pay?pa=${restaurantData.upiId}&am=${amt}`, width: 140, height: 140 });
            setUI('final-upi-id', restaurantData.upiId);
        }
    } else if(qrArea) { 
        qrArea.style.display = "none"; 
    }
    if(document.getElementById('final-place-btn')) document.getElementById('final-place-btn').disabled = false;
};

window.setOrderType = (type) => {
    orderType = type;
    const sub = cart.reduce((s, i) => s + (i.price * i.qty), 0);
    const btnP = document.getElementById('type-pickup');
    const btnD = document.getElementById('type-delivery');
    if(btnP) btnP.classList.toggle('active', type === 'Pickup');
    if(btnD) btnD.classList.toggle('active', type === 'Delivery');
    if(type === 'Delivery') {
        if(sub < 300) { alert("Min ₹300 order for delivery!"); window.setOrderType('Pickup'); return; }
        showEl('delivery-address-box');
    } else showEl('delivery-address-box', false);
};

// ==========================================
// 6. CONFIRM ORDER (Points & Instructions Fix)
// ==========================================
window.confirmOrder = async () => {
    const nameEl = document.getElementById('cust-name-final');
    if(!nameEl || !nameEl.value.trim()) return alert("Enter Name!");
    
    showEl('loader');
    const finalBill = document.getElementById('final-amt').innerText;
    
    const orderData = {
        resId, table: tableNo, customerName: nameEl.value, userUID, items: cart,
        total: finalBill, status: "Pending", paymentMode: selectedPaymentMode,
        orderType, timestamp: new Date(), 
        instruction: document.getElementById('chef-note').value || "",
        address: document.getElementById('cust-address') ? document.getElementById('cust-address').value : ""
    };

    try {
        await addDoc(collection(db, "orders"), orderData);
        
        // Points: ₹100 spend = 10 points
        const earned = Math.floor(parseInt(finalBill) / 10);
        let newPts = userPoints + earned;
        if(isRedeeming) newPts -= 1000;
        await setDoc(doc(db, "users", userUID), { points: newPts, name: nameEl.value }, { merge: true });

        showFlex('success-screen');
        setUI('s-name', nameEl.value);
        setUI('s-table', tableNo);
        localStorage.removeItem(`platto_cart_${resId}`);
        cart = []; updateCartUI();
    } catch(e) { alert(e.message); }
    showEl('loader', false);
};

// ==========================================
// 7. TRACKING & HELPERS
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
                list.innerHTML += `<div class="history-item"><b>Status: ${o.status}</b><br>Table ${o.table} | ₹${o.total}</div>`;
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
        if(o.status === "Picked Up" || o.status === "Done") {
            const date = o.timestamp ? o.timestamp.toDate().toLocaleDateString() : "--";
            list.innerHTML += `<div class="history-item"><b>${date}</b> - ₹${o.total}</div>`;
        }
    });
};

function updatePointsUI() {
    setUI('user-pts', userPoints);
    setUI('profile-pts-display', userPoints);
    const redeemBtn = document.getElementById('redeem-btn');
    if(redeemBtn) redeemBtn.disabled = userPoints < 1000;
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
    alert("Profile Saved!"); window.closeModal('profileModal');
};

function renderBranding() {
    setUI('res-name-display', restaurantData.name);
    if(document.getElementById('res-logo') && restaurantData.logoUrl) document.getElementById('res-logo').src = restaurantData.logoUrl;
    setUI('wait-time', restaurantData.prepTime || "20");
    setUI('res-about-text', restaurantData.about || "");
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

function loadMenu(category = 'All') {
    onSnapshot(collection(db, "restaurants", resId, "menu"), (snap) => {
        const grid = document.getElementById('menu-list');
        if(!grid) return; grid.innerHTML = "";
        snap.forEach(d => {
            const item = d.data();
            if(category !== 'All' && item.category !== category) return;
            grid.innerHTML += `<div class="food-card" onclick='window.openCustomize("${d.id}", ${JSON.stringify(item)})'><img src="${item.imgUrl || 'https://via.placeholder.com/150'}" class="food-img"><div><h4>${item.name}</h4><b>₹${item.price}</b></div></div>`;
        });
        showEl('loader', false);
    });
}

function handleAnnouncement() {
    if(restaurantData.activeAnnouncement) {
        showFlex('announcement-modal');
        setUI('ann-title', restaurantData.annTitle); setUI('ann-desc', restaurantData.annText);
    }
}

window.filterByCategory = (cat, btn) => {
    document.querySelectorAll('.cat-pill').forEach(b => b.classList.remove('active'));
    btn.classList.add('active'); loadMenu(cat);
};
window.closeModal = (id) => showEl(id, false);
window.openAuthModal = () => showFlex('authModal');
window.openProfileModal = () => showFlex('profileModal');
window.logout = () => signOut(auth).then(() => location.reload());
window.setAuthMode = (m) => currentAuthMode = m;
window.filterMenu = () => loadMenu();

init();
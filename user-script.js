import {
    db,
    auth
} from './firebase-config.js';
import {
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    onAuthStateChanged,
    signOut
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
    doc,
    getDoc,
    collection,
    onSnapshot,
    addDoc,
    query,
    where,
    setDoc,
    updateDoc,
    getDocs,
    orderBy
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

// Safety Helper: UI Update
const setUI = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.innerText = val;
};
const showEl = (id, show = true) => {
    const el = document.getElementById(id);
    if (el) el.style.display = show ? "block" : "none";
};
const showFlex = (id, show = true) => {
    const el = document.getElementById(id);
    if (el) el.style.display = show ? "flex" : "none";
};

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
        const navAuthBtn = document.getElementById('nav-auth-btn');
        const navProfileBtn = document.getElementById('nav-profile-btn');

        if (user) {
            userUID = user.uid;
            if (navAuthBtn) navAuthBtn.style.display = "none";
            if (navProfileBtn) navProfileBtn.style.display = "flex";

            // Real-time listener for Points
            onSnapshot(doc(db, "users", userUID), (uSnap) => {
                if (uSnap.exists()) {
                    userPoints = uSnap.data().points || 0;
                    updatePointsUI();
                    if (document.getElementById('user-profile-name')) document.getElementById('user-profile-name').value = uSnap.data().name || "";
                    if (document.getElementById('user-profile-phone')) document.getElementById('user-profile-phone').value = uSnap.data().phone || "";
                    if (document.getElementById('cust-name-final')) document.getElementById('cust-name-final').value = uSnap.data().name || "";
                }
            });
        } else {
            userUID = localStorage.getItem('p_guest_id') || "g_" + Date.now();
            if (!localStorage.getItem('p_guest_id')) localStorage.setItem('p_guest_id', userUID);
            if (navAuthBtn) navAuthBtn.style.display = "flex";
            if (navProfileBtn) navProfileBtn.style.display = "none";
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
    if (document.getElementById('res-logo') && restaurantData.logoUrl) document.getElementById('res-logo').src = restaurantData.logoUrl;

    // WiFi Display
    const wifiBox = document.getElementById('wifi-display');
    if (restaurantData.wifiName && wifiBox) {
        wifiBox.style.display = "flex";
        setUI('wifi-name', restaurantData.wifiName);
        setUI('wifi-pass', restaurantData.wifiPass);
    }
    // Social Links
    if (document.getElementById('link-fb')) document.getElementById('link-fb').href = restaurantData.fbLink || "#";
    if (document.getElementById('link-ig')) document.getElementById('link-ig').href = restaurantData.igLink || "#";
    if (document.getElementById('link-yt')) document.getElementById('link-yt').href = restaurantData.ytLink || "#";
    if (document.getElementById('whatsapp-btn')) document.getElementById('whatsapp-btn').href = `https://wa.me/91${restaurantData.ownerPhone}`;
}

function renderCategories() {
    const list = document.getElementById('categories-list');
    if (restaurantData.categories && list) {
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
        if (!grid) return;
        grid.innerHTML = "";
        const searchInput = document.getElementById('menu-search');
        const search = searchInput ? searchInput.value.toLowerCase() : "";

        snap.forEach(d => {
            const item = d.data();
            if (category !== 'All' && item.category !== category) return;
            if (search && !item.name.toLowerCase().includes(search)) return;

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
    currentItemToCustomize = {
        ...item,
        id
    };
    document.getElementById('cust-item-name').innerText = item.name;
    setUI('p-price-s', "₹" + item.price);
    setUI('p-price-m', "₹" + (parseInt(item.price) + 50));
    setUI('p-price-l', "₹" + (parseInt(item.price) + 100));

    const extrasDiv = document.getElementById('extras-options');
    if (extrasDiv) {
        extrasDiv.innerHTML = "";
        if (restaurantData.variants) {
            restaurantData.variants.forEach(v => {
                extrasDiv.innerHTML += `
                    <label class="option-row">
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
    if (size === 'Medium') price += 50;
    if (size === 'Large') price += 100;
    document.querySelectorAll('.ex-item:checked').forEach(el => price += parseInt(el.dataset.price));

    cart.push({
        id: Date.now(),
        name: `${currentItemToCustomize.name} (${size})`,
        price,
        qty: 1
    });
    saveCart();
    window.closeModal('customizeModal');
};

// ==========================================
// 4. BASKET & QUANTITY Logic
// ==========================================
function saveCart() {
    localStorage.setItem(`platto_cart_${resId}`, JSON.stringify(cart));
    updateCartUI();
}

function updateCartUI() {
    const totalQty = cart.reduce((s, i) => s + i.qty, 0);
    const totalAmt = cart.reduce((s, i) => s + (i.price * i.qty), 0);
    const bar = document.getElementById('cart-bar');
    if (cart.length > 0 && bar) {
        showFlex('cart-bar');
        setUI('cart-qty', totalQty + " Items");
        setUI('cart-total', totalAmt);
        if (document.getElementById('cart-badge-count')) document.getElementById('cart-badge-count').innerText = totalQty;
    } else if (bar) showEl('cart-bar', false);
}

window.openCartModal = () => {
    showFlex('cartModal');
    window.renderCartList();
};
    const list = document.getElementById('cart-items-list');
    list.innerHTML = cart.length === 0 ? "<p style='padding:20px;'>Basket is empty</p>" : "";
    let sub = 0;
    cart.forEach((item, index) => {
        sub += item.price * item.qty;
        list.innerHTML += `
        <div class="cart-item">
            <div style="text-align:left;"><b>${item.name}</b><br><small>₹${item.price}</small></div>
            <div class="qty-btn-box">
                <button onclick="window.changeQty(${index}, -1)">-</button>
                <span>${item.qty}</span>
                <button onclick="window.changeQty(${index}, 1)">+</button>
            </div>
            <b>₹${item.price * item.qty}</b>
        </div>`;
    });
    setUI('summary-subtotal', "₹" + sub);
    setUI('available-pts', userPoints);
    showEl('redeem-section', (userPoints >= 1000 && cart.length > 0));
    setUI('summary-total', "₹" + (isRedeeming ? sub - 10 : sub));
    showFlex('discount-line', isRedeeming);
};

window.changeQty = (index, delta) => {

    cart[index].qty = (cart[index].qty || 1) + delta;

    if (cart[index].qty <= 0)
        cart.splice(index, 1);

    // Coupon reset if cart changes
    if (appliedCouponCode) {
        couponDiscount = 0;
        appliedCouponCode = "";
    }

    localStorage.setItem(`platto_cart_${resId}`, JSON.stringify(cart));

    updateCartUI();
    window.renderCartList();
};
// ==========================================
// PROFESSIONAL BASKET RENDER
// ==========================================
window.renderCartList = () => {
    const list = document.getElementById('cart-items-list');
    if (!list) return;

    list.innerHTML = cart.length === 0
        ? "<div style='padding:40px; color:gray;'>Empty Basket</div>"
        : "";

    let subtotal = 0;

    cart.forEach((item, index) => {
        const itemTotal = item.price * (item.qty || 1);
        subtotal += itemTotal;

        list.innerHTML += `
        <div class="cart-item">
            <div class="item-info-box">
                <b>${item.name}</b>
                <small>Unit Price: ₹${item.price}</small>
            </div>

            <div class="qty-wrapper">
                <button class="qty-btn-basket" onclick="window.changeQty(${index}, -1)">-</button>
                <span class="qty-number">${item.qty || 1}</span>
                <button class="qty-btn-basket" onclick="window.changeQty(${index}, 1)">+</button>
            </div>

            <div class="item-total-price">₹${itemTotal}</div>
        </div>`;
    });

    // Subtotal
    setUI('summary-subtotal', "₹" + subtotal);

    // Coupon Display
    const discountLine = document.getElementById('coupon-discount-line');
    const discountVal = document.getElementById('coupon-discount-val');

    if (couponDiscount > 0) {
        if (discountLine) discountLine.style.display = "flex";
        if (discountVal) discountVal.innerText = "-₹" + couponDiscount;
    } else {
        if (discountLine) discountLine.style.display = "none";
    }

    // Final Total
    let totalPayable = subtotal;

    if (isRedeeming) totalPayable -= 10;
    totalPayable -= couponDiscount;

    setUI('summary-total', "₹" + (totalPayable < 0 ? 0 : totalPayable));
};
// ==========================================
// 5. CHECKOUT & DELIVERY (3KM Rule)
// ==========================================
window.openCheckoutModal = () => {
    if (cart.length === 0) return alert("Add items first!");
    window.closeModal('cartModal');
    showFlex('checkoutModal');
    const sub = cart.reduce((s, i) => s + (i.price * i.qty), 0);
    setUI('final-amt', isRedeeming ? sub - 10 : sub);
};

window.setOrderType = (type) => {
    orderType = type;
    const sub = cart.reduce((s, i) => s + (i.price * i.qty), 0);
    document.getElementById('type-pickup').classList.toggle('active', type === 'Pickup');
    document.getElementById('type-delivery').classList.toggle('active', type === 'Delivery');
    if (type === 'Delivery') {
        if (sub < 300) {
            alert("Min ₹300 order for delivery!");
            window.setOrderType('Pickup');
            return;
        }
        showEl('delivery-address-box');
    } else showEl('delivery-address-box', false);
};

window.setPayMode = (mode) => {
    selectedPaymentMode = mode;
    document.getElementById('mode-online').classList.toggle('selected', mode === 'Online');
    document.getElementById('mode-cash').classList.toggle('selected', mode === 'Cash');
    if (mode === 'Online') {
        showEl('payment-qr-area');
        const qrDiv = document.getElementById('checkout-payment-qr');
        qrDiv.innerHTML = "";
        const amt = document.getElementById('final-amt').innerText;
        new QRCode(qrDiv, {
            text: `upi://pay?pa=${restaurantData.upiId}&am=${amt}`,
            width: 140,
            height: 140
        });
        setUI('final-upi-id', restaurantData.upiId);
    } else showEl('payment-qr-area', false);
    if (document.getElementById('final-place-btn')) document.getElementById('final-place-btn').disabled = false;
};
// ==========================================
// APPLY COUPON
// ==========================================
window.applyCoupon = async () => {

    const codeInput = document.getElementById('coupon-code');
    const code = codeInput.value.trim().toUpperCase();

    if (!code) return alert("Please enter coupon code");

    const subtotal = cart.reduce((s, i) => s + (i.price * i.qty), 0);

    try {

        const q = query(
            collection(db, "restaurants", resId, "coupons"),
            where("code", "==", code)
        );

        const snap = await getDocs(q);

        if (!snap.empty) {

            const couponData = snap.docs[0].data();

            if (subtotal < couponData.minOrder) {
                alert(`Coupon valid above ₹${couponData.minOrder}`);
                return;
            }

            couponDiscount = Math.floor((subtotal * couponData.percent) / 100);

            if (couponDiscount > couponData.maxDiscount)
                couponDiscount = couponData.maxDiscount;

            appliedCouponCode = code;

            alert(`🎉 ₹${couponDiscount} discount applied!`);
            window.renderCartList();

        } else {
            alert("Invalid Coupon Code");
        }

    } catch (e) {
        console.error(e);
        alert("Coupon error. Try later.");
    }
};

// ==========================================
// 6. CONFIRM ORDER & LOYALTY
// ==========================================
window.confirmOrder = async () => {
    const name = document.getElementById('cust-name-final').value;
    if (!name) return alert("Enter Name!");
    showEl('loader');
    const subtotal = cart.reduce((s, i) => s + (i.price * i.qty), 0);
let finalBill = subtotal;

if (isRedeeming) finalBill -= 10;
finalBill -= couponDiscount;
if (finalBill < 0) finalBill = 0;
    const orderData = {
        resId,
        table: tableNo,
        customerName: name,
        userUID,
        items: cart,
        total: finalBill,
        status: "Pending",
        paymentMode: selectedPaymentMode,
        orderType,
        timestamp: new Date(),
        note: document.getElementById('chef-note').value || "",
        address: document.getElementById('cust-address') ? document.getElementById('cust-address').value : ""
    };

    try {
        await addDoc(collection(db, "orders"), orderData);
        window.closeModal('checkoutModal');
        showFlex('success-screen');
        setUI('s-name', name);
        setUI('s-table', tableNo);

        // Update Points (₹100 = 10pts)
        const earned = Math.floor(parseInt(finalBill) / 10);
        let newPts = userPoints + earned;
        if (isRedeeming) newPts -= 1000;
        await setDoc(doc(db, "users", userUID), {
            points: newPts,
            name: name
        }, {
            merge: true
        });

        localStorage.removeItem(`platto_cart_${resId}`);
        cart = [];
        updateCartUI();
    } catch (e) {
        alert(e.message);
    }
    showEl('loader', false);
};

// ==========================================
// 7. HISTORY & TRACKING
// ==========================================
window.openHistoryModal = async () => {
    showFlex('historyModal');
    const list = document.getElementById('history-items-list');
    list.innerHTML = "Loading...";
    const q = query(collection(db, "orders"), where("userUID", "==", userUID), orderBy("timestamp", "desc"));
    const snap = await getDocs(q);
    list.innerHTML = snap.empty ? "<p>No orders yet.</p>" : "";
    snap.forEach(d => {
        const o = d.data();
        list.innerHTML += `<div class="history-item"><b>${o.timestamp.toDate().toLocaleDateString()}</b> - ₹${o.total} [${o.status}]</div>`;
    });
};

window.openTrackingModal = () => {
    showFlex('trackingModal');
    const list = document.getElementById('live-tracking-list');
    onSnapshot(query(collection(db, "orders"), where("userUID", "==", userUID)), (snap) => {
        if (!list) return;
        list.innerHTML = "";
        let hasLive = false;
        snap.forEach(d => {
            const o = d.data();
            if (!["Picked Up", "Rejected", "Done"].includes(o.status)) {
                hasLive = true;
                list.innerHTML += `<div class="history-item"><b>${o.status}</b><br>Table ${o.table} | Total: ₹${o.total}</div>`;
            }
        });
        if (!hasLive) list.innerHTML = "<p>No active orders.</p>";
    });
};

// ==========================================
// 8. OTHERS (AUTH, WIFI, ANNOUNCEMENT)
// ==========================================
function updatePointsUI() {
    setUI('user-pts', userPoints);
    setUI('profile-pts-display', userPoints);
    const btn = document.getElementById('redeem-btn');
    if (btn) btn.disabled = userPoints < 1000;
}

window.redeemPoints = () => {
    isRedeeming = true;
    alert("Reward Applied!");
    window.openCartModal();
};
window.setAuthMode = (m) => {
    currentAuthMode = m;
    document.getElementById('tab-login').classList.toggle('active', m === 'login');
    document.getElementById('tab-signup').classList.toggle('active', m === 'signup');
};
window.handleAuth = async () => {
    const e = document.getElementById('auth-email').value;
    const p = document.getElementById('auth-pass').value;
    try {
        if (currentAuthMode === 'login') await signInWithEmailAndPassword(auth, e, p);
        else await createUserWithEmailAndPassword(auth, e, p);
        window.closeModal('authModal');
    } catch (err) {
        alert(err.message);
    }
};
window.saveUserProfile = async () => {
    const n = document.getElementById('user-profile-name').value;
    const ph = document.getElementById('user-profile-phone').value;
    await setDoc(doc(db, "users", userUID), {
        name: n,
        phone: ph
    }, {
        merge: true
    });
    alert("Saved!");
    window.closeModal('profileModal');
};
window.logout = () => signOut(auth).then(() => location.reload());
window.closeModal = (id) => showEl(id, false);
window.openAuthModal = () => showFlex('authModal');
window.openProfileModal = () => showFlex('profileModal');
window.filterByCategory = (cat, btn) => {
    document.querySelectorAll('.cat-pill').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    loadMenu(cat);
};

function handleAnnouncement() {
    if (restaurantData.activeAnnouncement) {
        showFlex('announcement-modal');
        setUI('ann-title', restaurantData.annTitle);
        setUI('ann-desc', restaurantData.annText);
    }
}
window.filterMenu = () => loadMenu();

init();
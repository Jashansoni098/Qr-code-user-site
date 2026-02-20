import { db } from './firebase-config.js';
import { doc, getDoc, collection, onSnapshot, addDoc, query, where, setDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const urlParams = new URLSearchParams(window.location.search);
const resId = urlParams.get('resId');
const tableNo = urlParams.get('table') || "01";

let cart = [];
let total = 0;
let restaurantData = {};
let selectedPaymentMode = "";
let userUID = localStorage.getItem('platto_uid') || "u_" + Date.now();
localStorage.setItem('platto_uid', userUID);

const loader = document.getElementById('loader');

// --- Initialization ---
async function initApp() {
    if (!resId) {
        document.body.innerHTML = "<div style='text-align:center; padding:100px;'><h3>⚠️ Please scan the QR code.</h3></div>";
        return;
    }
    try {
        const resRef = doc(db, "restaurants", resId);
        const resSnap = await getDoc(resRef);
        if (resSnap.exists()) {
            restaurantData = resSnap.data();
            document.getElementById('res-name-display').innerText = restaurantData.name;
            document.getElementById('res-address-display').innerText = restaurantData.address || "Digital Menu Enabled";
            document.getElementById('wait-time').innerText = restaurantData.prepTime || "20";
            document.getElementById('res-about-text').innerText = restaurantData.about || "Enjoy our authentic food experience.";
            document.getElementById('tbl-no').innerText = tableNo;
            if (restaurantData.logoUrl) document.getElementById('res-logo').src = restaurantData.logoUrl;
            document.getElementById('whatsapp-btn').href = `https://wa.me/91${restaurantData.ownerPhone}`;
        }
        fetchLoyalty();
        loadMenu();
        checkLiveOrders();
    } catch (err) { console.error(err); }
}

async function fetchLoyalty() {
    const userRef = doc(db, "users", userUID);
    const userSnap = await getDoc(userRef);
    let pts = userSnap.exists() ? userSnap.data().points : 0;
    document.getElementById('user-pts').innerText = pts;
}

function loadMenu() {
    const menuRef = collection(db, "restaurants", resId, "menu");
    onSnapshot(menuRef, (snapshot) => {
        const container = document.getElementById('menu-list');
        if(!container) return;
        container.innerHTML = "";
        const isVegOnly = document.getElementById('veg-toggle').checked;
        const searchQuery = document.getElementById('menu-search').value.toLowerCase();

        snapshot.forEach(d => {
            const item = d.data();
            if (isVegOnly && !item.name.toLowerCase().includes('veg')) return;
            if (searchQuery && !item.name.toLowerCase().includes(searchQuery)) return;

            container.innerHTML += `
                <div class="food-card">
                    <div class="food-info">
                        <h4>${item.name}</h4>
                        <div class="food-price">₹${item.price}</div>
                    </div>
                    <button class="add-btn" onclick="addToCart('${item.name}', ${item.price})">ADD</button>
                </div>`;
        });
        if(loader) loader.style.display = 'none';
    });
}

window.filterMenu = () => loadMenu();

window.addToCart = (name, price) => {
    cart.push({ name, price });
    total += parseInt(price);
    document.getElementById('cart-bar').style.display = 'flex';
    document.getElementById('cart-qty').innerText = `${cart.length} Items`;
    document.getElementById('cart-total').innerText = total;
};

// --- Checkout & Payment Fix ---
window.openPaymentModal = () => {
    document.getElementById('paymentModal').style.display = 'flex';
    let finalPayable = total;
    const pts = parseInt(document.getElementById('user-pts').innerText);
    const discountMsg = document.getElementById('loyalty-discount-msg');
    
    if(pts >= 1000) {
        finalPayable = total - 10;
        if(discountMsg) discountMsg.style.display = 'block';
    } else {
        if(discountMsg) discountMsg.style.display = 'none';
    }
    document.getElementById('final-amt').innerText = finalPayable < 0 ? 0 : finalPayable;
    
    selectedPaymentMode = "";
    document.getElementById('online-qr-section').style.display = 'none';
    document.getElementById('cash-msg-section').style.display = 'none';
    document.getElementById('final-confirm-btn').disabled = true;
    document.querySelectorAll('.pay-choice-btn').forEach(b => b.classList.remove('selected'));
};

window.selectPaymentMode = (mode) => {
    selectedPaymentMode = mode;
    document.querySelectorAll('.pay-choice-btn').forEach(b => b.classList.remove('selected'));
    
    if(mode === 'Online') {
        document.getElementById('btn-pay-online').classList.add('selected');
        document.getElementById('online-qr-section').style.display = 'block';
        document.getElementById('cash-msg-section').style.display = 'none';
        
        const qrDiv = document.getElementById('payment-qr');
        qrDiv.innerHTML = "";
        const finalAmt = document.getElementById('final-amt').innerText;
        const upiLink = `upi://pay?pa=${restaurantData.upiId}&pn=${restaurantData.name}&am=${finalAmt}&cu=INR`;
        new QRCode(qrDiv, { text: upiLink, width: 150, height: 150 });
        document.getElementById('display-upi-id').innerText = restaurantData.upiId;
    } else {
        document.getElementById('btn-pay-cash').classList.add('selected');
        document.getElementById('online-qr-section').style.display = 'none';
        document.getElementById('cash-msg-section').style.display = 'block';
    }
    document.getElementById('final-confirm-btn').disabled = false;
};

window.confirmOrder = async () => {
    const custName = document.getElementById('cust-name').value.trim();
    if(!custName) return alert("Kripya apna naam bhariye!");
    
    const finalAmt = parseInt(document.getElementById('final-amt').innerText);
    const instruction = document.getElementById('chef-instruction').value;

    if(loader) loader.style.display = 'flex';
    try {
        const orderData = {
            resId, table: tableNo, customerName: custName,
            paymentMode: selectedPaymentMode, items: cart,
            total: finalAmt, status: "Pending",
            timestamp: new Date(), instruction, userUID
        };
        await addDoc(collection(db, "orders"), orderData);

        // Loyalty Update
        const earned = Math.floor(total / 100) * 10;
        const userRef = doc(db, "users", userUID);
        const userSnap = await getDoc(userRef);
        let currentPts = userSnap.exists() ? userSnap.data().points : 0;
        if(currentPts >= 1000) currentPts -= 1000;
        await setDoc(userRef, { points: currentPts + earned }, { merge: true });

        // Success View
        document.getElementById('paymentModal').style.display = 'none';
        document.getElementById('success-screen').style.display = 'flex';
        document.getElementById('summary-name').innerText = custName;
        document.getElementById('summary-table').innerText = tableNo;

        cart = []; total = 0;
        document.getElementById('cart-bar').style.display = 'none';
    } catch (e) { alert(e.message); }
    if(loader) loader.style.display = 'none';
};

// --- Utils ---
window.closeModal = () => document.getElementById('paymentModal').style.display = 'none';
window.closeSuccess = () => location.reload();
window.copyUPI = () => { navigator.clipboard.writeText(restaurantData.upiId); alert("UPI ID Copied!"); };

function checkLiveOrders() {
    const q = query(collection(db, "orders"), where("userUID", "==", userUID), where("status", "!=", "Picked Up"));
    onSnapshot(q, (snapshot) => {
        if (!snapshot.empty) {
            const order = snapshot.docs[0].data();
            const banner = document.getElementById('tracking-banner');
            if(banner) {
                banner.style.display = 'flex';
                document.getElementById('track-status-text').innerText = (order.status === "Pending") ? "Received!" : (order.status === "Preparing") ? "Cooking...🔥" : "Ready! ✅";
                if(order.status === "Ready") document.getElementById('download-bill-btn').style.display = 'block';
                window.activeOrder = order;
            }
        }
    });
}

window.generateInvoice = () => {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const order = window.activeOrder;
    doc.text(`Bill: ${restaurantData.name}`, 10, 20);
    doc.text(`Customer: ${order.customerName} | Table: ${order.table}`, 10, 30);
    doc.text(`Total: ₹${order.total}`, 10, 40);
    doc.save("Order_Receipt.pdf");
};

initApp();
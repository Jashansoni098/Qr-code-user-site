import { db } from './firebase-config.js';
import { doc, getDoc, collection, onSnapshot, addDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const urlParams = new URLSearchParams(window.location.search);
const resId = urlParams.get('resId');
const tableNo = urlParams.get('table') || "01";

let cart = [];
let total = 0;
let restaurantUPI = "";

async function init() {
    if(!resId) {
        document.body.innerHTML = "<h2 style='text-align:center; margin-top:50px;'>⚠️ Invalid QR. Scan again.</h2>";
        return;
    }

    // 1. Restaurant Details & Call Button
    const resRef = doc(db, "restaurants", resId);
    const snap = await getDoc(resRef);
    if(snap.exists()) {
        const data = snap.data();
        document.getElementById('res-name-display').innerText = data.name;
        document.getElementById('res-address').innerText = data.address || "Digital Menu Enabled";
        document.getElementById('display-upi').innerText = data.upiId || "Cash Payment Only";
        restaurantUPI = data.upiId;
        
        // Update Call Button
        const phone = data.ownerPhone || "0000000000";
        document.getElementById('call-btn').href = `tel:${phone}`;
    }

    // 2. Menu Items (Real-time)
    const menuRef = collection(db, "restaurants", resId, "menu");
    onSnapshot(menuRef, (snapshot) => {
        const menuList = document.getElementById('menu-list');
        menuList.innerHTML = "";
        snapshot.forEach(d => {
            const item = d.data();
            menuList.innerHTML += `
                <div class="food-card animate-in">
                    <div class="food-details">
                        <h4>${item.name}</h4>
                        <div class="price-tag">₹${item.price}</div>
                    </div>
                    <button class="add-btn" onclick="addToCart('${item.name}', ${item.price})">ADD +</button>
                </div>
            `;
        });
        document.getElementById('loader').style.display = 'none';
    });
}

window.addToCart = (name, price) => {
    cart.push({name, price});
    total += parseInt(price);
    
    document.getElementById('cart-bar').style.display = 'flex';
    document.getElementById('cart-qty').innerText = `${cart.length} Items`;
    document.getElementById('cart-total').innerText = `₹${total}`;
};

window.openPaymentModal = () => {
    document.getElementById('paymentModal').style.display = 'flex';
    const qrDiv = document.getElementById('payment-qr');
    qrDiv.innerHTML = "";
    
    // UPI QR Logic (Deep Link)
    const upiLink = `upi://pay?pa=${restaurantUPI}&pn=Restaurant&am=${total}&cu=INR`;
    new QRCode(qrDiv, { text: upiLink, width: 180, height: 180 });
};

window.closeModal = () => document.getElementById('paymentModal').style.display = 'none';

window.confirmOrder = async () => {
    const orderData = {
        resId, table: tableNo, items: cart, total, status: "Pending", time: new Date()
    };
    await addDoc(collection(db, "orders"), orderData);
    alert("🎉 Order Confirmed! Keep the payment screenshot ready.");
    location.reload();
};

init();
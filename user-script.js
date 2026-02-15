import { db } from './firebase-config.js';
import { doc, getDoc, collection, onSnapshot, addDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const urlParams = new URLSearchParams(window.location.search);
const resId = urlParams.get('resId');
const tableNo = urlParams.get('table') || "NA";

let cart = [];
let totalPrice = 0;

async function initUserSite() {
    if(!resId) {
        document.body.innerHTML = "<div style='padding:50px; text-align:center;'><h2>⚠️ Please scan QR again</h2></div>";
        return;
    }

    document.getElementById('tbl-no').innerText = tableNo;

    // 1. Fetch Restaurant Info
    const resRef = doc(db, "restaurants", resId);
    const resSnap = await getDoc(resRef);
    
    if(resSnap.exists()) {
        const data = resSnap.data();
        document.getElementById('res-name-display').innerText = data.name;
        if(data.logoUrl) document.getElementById('res-logo').src = data.logoUrl;
    }

    // 2. Fetch Menu Items (Real-time)
    const menuRef = collection(db, "restaurants", resId, "menu");
    onSnapshot(menuRef, (snapshot) => {
        const menuList = document.getElementById('menu-list');
        menuList.innerHTML = "";
        
        snapshot.forEach((doc) => {
            const item = doc.data();
            menuList.innerHTML += `
                <div class="food-card">
                    <div class="food-info">
                        <h4>${item.name}</h4>
                        <div class="food-price">₹${item.price}</div>
                    </div>
                    <button class="add-btn" onclick="addToCart('${item.name}', ${item.price})">ADD</button>
                </div>
            `;
        });
        document.getElementById('loader').style.display = 'none';
    });
}

window.addToCart = (name, price) => {
    cart.push({name, price});
    totalPrice += parseInt(price);
    updateCartUI();
};

function updateCartUI() {
    const cartBar = document.getElementById('cart-bar');
    if(cart.length > 0) {
        cartBar.style.display = 'flex';
        document.getElementById('cart-count').innerText = `${cart.length} Items`;
        document.getElementById('cart-total').innerText = `₹${totalPrice}`;
    }
}

window.placeOrder = async () => {
    alert("Placing your order for Table " + tableNo);
    // Order logic to Firestore
    const orderData = {
        resId: resId,
        table: tableNo,
        items: cart,
        total: totalPrice,
        status: "Pending",
        timestamp: new Date()
    };
    await addDoc(collection(db, "orders"), orderData);
    alert("Order Placed Successfully!");
    cart = []; totalPrice = 0;
    document.getElementById('cart-bar').style.display = 'none';
};

initUserSite();
import { db } from './firebase-config.js';
import { doc, getDoc, collection, onSnapshot, addDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// Global Variables
const urlParams = new URLSearchParams(window.location.search);
const resId = urlParams.get('resId');
const tableNo = urlParams.get('table') || "0";

let cart = [];
let totalPrice = 0;
const loader = document.getElementById('loader');

// --- 1. Initialization Function ---
async function initUserSite() {
    console.log("Initializing Site for ResID:", resId);

    if (!resId) {
        loader.style.display = 'none';
        document.body.innerHTML = `
            <div style='padding:50px; text-align:center; font-family:sans-serif;'>
                <h2>⚠️ Invalid QR Code</h2>
                <p>Kripya restaurant ka sahi QR code scan karein.</p>
            </div>`;
        return;
    }

    try {
        document.getElementById('tbl-no').innerText = tableNo;

        // Fetch Restaurant Header Data
        const resRef = doc(db, "restaurants", resId);
        const resSnap = await getDoc(resRef);

        if (resSnap.exists()) {
            const data = resSnap.data();
            document.getElementById('res-name-display').innerText = data.name;
            if (data.logoUrl) document.getElementById('res-logo').src = data.logoUrl;
        } else {
            console.error("Restaurant not found in Database");
        }

        // Fetch Menu Items (Real-time)
        const menuRef = collection(db, "restaurants", resId, "menu");
        onSnapshot(menuRef, (snapshot) => {
            const menuList = document.getElementById('menu-list');
            menuList.innerHTML = "";

            if (snapshot.empty) {
                menuList.innerHTML = "<p style='text-align:center; color:gray;'>Menu items loading or not available.</p>";
            }

            snapshot.forEach((doc) => {
                const item = doc.data();
                menuList.innerHTML += `
                    <div class="food-card animate-in">
                        <div class="food-info">
                            <h4>${item.name}</h4>
                            <div class="food-price">₹${item.price}</div>
                        </div>
                        <button class="add-btn" onclick="addToCart('${item.name}', ${item.price})">ADD</button>
                    </div>
                `;
            });
            // Data aate hi loader band
            loader.style.display = 'none';
        }, (error) => {
            console.error("Firestore Menu Error:", error);
            loader.style.display = 'none';
        });

    } catch (error) {
        console.error("General Initialization Error:", error);
        loader.style.display = 'none';
        alert("Koshish karein: Page refresh karein ya internet check karein.");
    }
}

// --- 2. Global Functions (Window attached) ---
window.addToCart = (name, price) => {
    cart.push({ name, price });
    totalPrice += parseInt(price);
    
    const cartBar = document.getElementById('cart-bar');
    cartBar.style.display = 'flex';
    document.getElementById('cart-count').innerText = `${cart.length} Items`;
    document.getElementById('cart-total').innerText = `₹${totalPrice}`;
    
    // Haptic feedback feel (vibration) agar mobile par ho
    if (window.navigator.vibrate) window.navigator.vibrate(50);
};

window.placeOrder = async () => {
    if (cart.length === 0) return;

    const btn = document.querySelector('.checkout-btn');
    btn.innerText = "Placing...";
    btn.disabled = true;

    try {
        const orderData = {
            resId: resId,
            table: tableNo,
            items: cart,
            total: totalPrice,
            status: "Pending",
            timestamp: new Date()
        };
        await addDoc(collection(db, "orders"), orderData);
        alert("🎉 Order Placed Successfully! Kitchen ko inform kar diya gaya hai.");
        
        // Reset Cart
        cart = [];
        totalPrice = 0;
        document.getElementById('cart-bar').style.display = 'none';
    } catch (e) {
        alert("Order error: " + e.message);
    } finally {
        btn.innerText = "Place Order →";
        btn.disabled = false;
    }
};

// Start the app
initUserSite();
// Firebase Configuration for Phone Store Demo - CDN Version
// إعدادات Firebase للمستودع الجديد - نسخة CDN

const firebaseConfig = {
  apiKey: "AIzaSyCOxP_fOupA-OAyO4oxYe54ohZ8_YzS7zc",
  authDomain: "aldhahbi-7a93b.firebaseapp.com",
  projectId: "aldhahbi-7a93b",
  storageBucket: "aldhahbi-7a93b.firebasestorage.app",
  messagingSenderId: "392213757842",
  appId: "1:392213757842:web:510288ddc8ccd5d7e48b4b",
  measurementId: "G-77EPVYFWPB"
};

// تهيئة Firebase باستخدام CDN
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getAnalytics } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-analytics.js';

// تهيئة التطبيق
const app = initializeApp(firebaseConfig);

// تهيئة الخدمات
const db = getFirestore(app);
const auth = getAuth(app);
const analytics = getAnalytics(app);

// تصدير الخدمات للاستخدام في الملفات الأخرى
window.firebaseDB = db;
window.firebaseAuth = auth;
window.firebaseAnalytics = analytics;

console.log('🔥 Firebase initialized successfully!');
console.log('📊 Firestore Database:', db);
console.log('🔐 Authentication:', auth);
console.log('📈 Analytics:', analytics);

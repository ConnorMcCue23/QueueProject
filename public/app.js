console.log("[queue] app.js loaded");

import { initializeApp, getApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import {
  getFirestore,
  connectFirestoreEmulator,
  collection,
  addDoc,
  serverTimestamp,
  doc,
  setDoc
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

const app = initializeApp(window.FIREBASE_CONFIG);

const db = getFirestore(app);

if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
  connectFirestoreEmulator(db, "localhost", 8080);
  console.log("[queue] Firestore: connected to EMULATOR @ localhost:8080");
}

/* 4) Form wiring */
const form = document.getElementById("joinForm");
const msg = document.getElementById("msg");
const err = document.getElementById("err");

function showOk(text) {
  msg.className = "note ok";
  msg.textContent = text;
  err.className = "alert";
  err.textContent = "";
}
function showErr(text) {
  err.className = "alert err";
  err.textContent = text;
  msg.className = "note";
  msg.textContent = "";
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const data = Object.fromEntries(new FormData(form).entries());
  const name = (data.name || "").trim();
  const phone = (data.phone || "").trim();
  const email = (data.email || "").trim().toLowerCase();
  const notify = data.notify || "";

  if (!name) return showErr("Please enter your name.");
  if (!notify) return showErr("Please choose a notification method.");
  if (notify === "sms" && !phone) return showErr("Add a phone number for SMS.");
  if (notify === "email" && !email) return showErr("Add an email address.");
  if (notify === "both" && !phone && !email) return showErr("Add at least one contact method.");

  try {
    const docRef = await addDoc(collection(db, "queue_entries"), {
      name,
      phone: phone || null,
      email: email || null,
      notify,                // 'sms' | 'email' | 'both'
      status: "waiting",
      createdAt: serverTimestamp()
    });


    await setDoc(doc(db, "queue_public", docRef.id), {
      name,
      status: "waiting",
      createdAt: serverTimestamp()
    });

    console.log("[queue] wrote doc id:", docRef.id);
    form.reset();

    showOk(`You're in! Entry ID ${docRef.id}`);
  } catch (e2) {
    console.error("[queue] write failed:", e2);
    showErr("Could not join the queue. Please try again.");
  }
});
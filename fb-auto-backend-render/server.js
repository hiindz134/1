// server.js
// ✅ Backend Messenger bot: verify webhook + auto reply
const express = require("express");
const axios = require("axios");
const crypto = require("crypto");
const app = express();

const {
  PAGE_ACCESS_TOKEN,
  VERIFY_TOKEN = "verify_token",
  APP_SECRET = "",
  GRAPH_VERSION = "v21.0",
  PORT = 3000,
} = process.env;

// Middleware để đọc raw body
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

// ✅ Route test để kiểm tra server sống
app.get("/", (req, res) => {
  res.send("Server is live ✅");
});

// ✅ Webhook xác minh từ Meta
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ WEBHOOK VERIFIED");
    res.status(200).send(challenge);
  } else {
    console.log("❌ WEBHOOK VERIFY FAILED");
    res.sendStatus(403);
  }
});

// ✅ Xử lý POST webhook (khi user nhắn tin vào page)
app.post("/webhook", async (req, res) => {
  const body = req.body;
  if (body.object === "page") {
    for (const entry of body.entry) {
      const event = entry.messaging && entry.messaging[0];
      if (!event) continue;

      const sender = event.sender.id;
      if (event.message && event.message.text) {
        const userMessage = event.message.text;
        console.log("💬 TIN NHẮN:", userMessage);
        await sendMessage(sender, `Bạn vừa nhắn: "${userMessage}"`);
      }
    }
    res.sendStatus(200);
  } else {
    res.sendStatus(404);
  }
});

// ✅ Hàm gửi tin nhắn lại người dùng
async function sendMessage(psid, text) {
  if (!PAGE_ACCESS_TOKEN) throw new Error("Thiếu PAGE_ACCESS_TOKEN!");
  await axios.post(
    `https://graph.facebook.com/${GRAPH_VERSION}/me/messages`,
    { recipient: { id: psid }, message: { text } },
    { params: { access_token: PAGE_ACCESS_TOKEN } }
  );
}

// ✅ Chạy server
app.listen(PORT, () => {
  console.log(`🚀 Backend chạy tại cổng ${PORT}`);
});

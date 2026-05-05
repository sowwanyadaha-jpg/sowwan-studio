const express = require("express");
const path = require("path");

const app = express();

// สำคัญมาก 👇
const PORT = process.env.PORT || 3000;

// เสิร์ฟไฟล์หน้าเว็บ
app.use(express.static(__dirname));

// หน้าแรก
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// start server
app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});

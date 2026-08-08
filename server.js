const express = require("express");

const app = express();
const PORT = 3000;

app.get("/", (req, res) => {
  res.send("AI Token Platform backend çalışıyor.");
});

app.listen(PORT, () => {
  console.log(`Sunucu http://localhost:${PORT} adresinde çalışıyor.`);
});
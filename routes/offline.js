const express = require('express');
const router = express.Router();
const asyncHandler = require('express-async-handler')
const config = require("../config.js");
const moment = require('moment')

router.get('/', asyncHandler(async (req, res, next) => {
  const service = res.app.locals.connS
  const networks = await service.scan()
  res.render('connectivity', {category: 'Connectivity', networks})
}))

router.post('/addWifi', asyncHandler(async (req, res, next) => {
  const {name, pwd} = req.body
  const service = res.app.locals.connS
  const ind = await service.exec(`sudo wpa_cli -i wlan0 add_network`)
  const index = parseInt(ind).toString()
  console.log(index)
  const resp1 = await service.exec(`sudo wpa_cli -i wlan0 set_network ${index} ssid '"${name}"'`)
  console.log(resp1)
  const resp2 = await service.exec(`sudo wpa_cli -i wlan0 set_network ${index} psk '"${pwd}"'`)
  console.log(resp2)
  const resp3 = await service.exec(`sudo wpa_cli -i wlan0 save_config`)
  console.log(resp3)
  const resp4 = await service.exec(`sudo sed -i '/disabled/d' /etc/wpa_supplicant/wpa_supplicant.conf`)
  console.log(resp4)
  res.json({a:1})
}))

router.post('/enableAP', asyncHandler(async (req, res, next) => {
  const service = res.app.locals.connS
  const resp1 = await service.exec(`sudo systemctl enable create_ap`)
  console.log(resp1)
  const resp2 = await service.exec(`sudo bash -c 'echo "ctrl_interface=DIR=/var/run/wpa_supplicant GROUP=netdev
update_config=1
" > /etc/wpa_supplicant/wpa_supplicant.conf'`)
  console.log(resp2)
  res.json({a:1})
}))

router.post('/disableAP', asyncHandler(async (req, res, next) => {
  const service = res.app.locals.connS
  const resp1 = await service.exec(`sudo systemctl disable create_ap`)
  console.log(resp1)
  res.json({a:1})
}))

router.post('/reboot', asyncHandler(async (req, res, next) => {
  const service = res.app.locals.connS
  const resp1 = await service.exec(`sudo reboot now`)
  console.log(resp1)
  res.json({a:1})
}))

module.exports = router;
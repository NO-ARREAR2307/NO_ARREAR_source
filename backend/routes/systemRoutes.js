'use strict';

const express = require('express');
const { getApiInfo, getHealth } = require('../controllers/systemController');

const router = express.Router();

router.get('/', getApiInfo);
router.get('/health', getHealth);

module.exports = router;

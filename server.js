const express = require('express');
const axios = require('axios');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const url = require('url');

const app = express();
app.use(cors());
app.use(express.json());

// HTML পেজগুলো সার্ভ করা
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/available.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'available.html'));
});

// ডোমেইন সেভ করার লজিক
const availableDir = path.join(__dirname, 'available_hns');
if (!fs.existsSync(availableDir)) {
    fs.mkdirSync(availableDir);
}

function saveAvailableDomain(domain, title) {
    const date = new Date().toISOString().split('T')[0]; 
    const filePath = path.join(availableDir, `${date}.json`);
    const safeTitle = (title && title.trim() !== '') ? title.trim() : 'সাধারণ তালিকা (General)';

    let data = {};
    if (fs.existsSync(filePath)) {
        try { 
            data = JSON.parse(fs.readFileSync(filePath, 'utf8')); 
            if (Array.isArray(data)) { data = { "সাধারণ তালিকা (General)": data }; }
        } catch (e) { data = {}; }
    }

    if (!data[safeTitle]) data[safeTitle] = [];
    if (!data[safeTitle].includes(domain)) data[safeTitle].push(domain);

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// ===============================================
// Streaming API
// ===============================================
app.post('/check-stream', async (req, res) => {
    const { rawText, title } = req.body;
    if (!rawText) return res.status(400).json({ error: "Text is required" });

    // ব্রাউজারকে জানিয়ে দেওয়া যে ডাটা খণ্ডে খণ্ডে আসবে
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const words = rawText.split(/[,\s\n]+/).map(w => w.trim().toLowerCase()).filter(w => w.length > 0);
    
    for (let i = 0; i < words.length; i++) {
        // ব্রাউজার যদি কানেকশন পুরোপুরি কেটে দেয় (Stop বাটন চাপলে)
        if (req.socket.destroyed) break;

        const originalName = words[i];
        let punycodeName = originalName;
        
        // বাংলা বা ইমোজির ক্ষেত্রে ক্র্যাশ প্রোটেকশন
        try { punycodeName = url.domainToASCII(originalName); } catch (e) { }

        let isAvailable = false;
        let stateText = '';

        try {
            const payload = JSON.stringify({ action: "getTLD", tld: punycodeName });
            const response = await axios.post('https://shakestation.io/api', payload, {
                headers: {
                    'Accept': '*/*',
                    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                    'User-Agent': 'Mozilla/5.0',
                    'Origin': 'https://shakestation.io',
                    'Referer': `https://shakestation.io/domain/${punycodeName}`
                }
            });

            const data = response.data;
            if (data && data.success && data.data) {
                const info = data.data;
                if (info.reserved) {
                    isAvailable = false;
                    stateText = 'RESERVED';
                } else if (info.openable === true) {
                    isAvailable = true;
                    stateText = 'AVAILABLE';
                } else if (info.openable === false) {
                    isAvailable = false;
                    stateText = info.auction && info.auction.status ? info.auction.status.toUpperCase() : 'TAKEN';
                }
            } else {
                stateText = 'API_ERROR';
            }
        } catch (err) {
            stateText = 'NETWORK_ERROR';
        }

        if (isAvailable) {
            try { saveAvailableDomain(originalName, title); } catch(e) {}
        }

        // রেজাল্ট রেডি হলেই পাঠিয়ে দেওয়া
        const resultObj = { name: originalName, available: isAvailable, state: stateText };
        res.write(JSON.stringify(resultObj) + '\n'); 

        // স্প্যামিং এড়াতে আধা সেকেন্ড বিরতি
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    res.end(); // সব ডোমেইন চেক শেষ হলে কানেকশন ক্লোজ করা
});

app.get('/available-domains', (req, res) => {
    const data = {};
    if (fs.existsSync(availableDir)) {
        const files = fs.readdirSync(availableDir);
        files.forEach(file => {
            if (file.endsWith('.json')) {
                const date = file.replace('.json', '');
                const filePath = path.join(availableDir, file);
                try {
                    let fileData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                    if (Array.isArray(fileData)) fileData = { "সাধারণ তালিকা (General)": fileData };
                    data[date] = fileData;
                } catch (e) { data[date] = {}; }
            }
        });
    }
    res.json(data);
});

app.listen(3000, () => console.log('🚀 সার্ভার চলছে! ব্রাউজারে যান: http://localhost:3000'));
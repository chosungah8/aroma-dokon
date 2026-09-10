const { bot, webServer } = require('./lib/server.js');

function readBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';

        req.on('data', chunk => {
            body += chunk;
        });

        req.on('end', () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            } catch (error) {
                reject(error);
            }
        });

        req.on('error', reject);
    });
}

module.exports = async function handler(req, res) {

if (req.url === '/api/products' && req.method === 'GET') {
    try {
        const { createClient } = require('@supabase/supabase-js');

        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_ROLE_KEY
        );

        const { data, error } = await supabase
            .from('products')
            .select('*')
            .eq('active', true)
            .order('id', { ascending: true });

        if (error) {
            throw error;
        }

        const products = (data || []).map(product => ({
            id: product.id,
            name: product.name,
            category: product.category,
            desc: product.description || '',
            price: Number(product.price) || 0,
            img: product.image || '',
            active: product.active !== false,
            stock: Number(product.stock) || 0
        }));

        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        return res.end(JSON.stringify(products));

    } catch (error) {
        console.error('PUBLIC PRODUCTS XATOSI:', error);

        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        return res.end(JSON.stringify({
            success: false,
            message: 'Mahsulotlarni yuklab bo‘lmadi'
        }));
    }
}

    if (req.url === '/api/telegram' && req.method === 'POST') {
        try {
            const update = req.body || await readBody(req);

            await bot.handleUpdate(update);

            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            return res.end(JSON.stringify({ ok: true }));
        } catch (error) {
            console.error('Telegram webhook error:', error);

            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            return res.end(JSON.stringify({
                ok: false,
                error: error.message
            }));
        }
    }

    return webServer.emit('request', req, res);
};

import { bot } from '../server.js';

export async function POST(request) {
    try {
        const update = await request.json();

        console.log('VERCEL TELEGRAM UPDATE:', JSON.stringify(update));

        await bot.handleUpdate(update);

        return Response.json({ ok: true });
    } catch (error) {
        console.error('Telegram webhook error:', error);

        return Response.json(
            { ok: false, error: error.message },
            { status: 500 }
        );
    }
}

export async function GET() {
    return Response.json({
        ok: false,
        error: 'Method Not Allowed'
    }, { status: 405 });
}

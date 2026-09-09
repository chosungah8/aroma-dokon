import handler from '../server.js';

export async function POST(request) {
    try {
        const body = await request.json();

        const result = await handler({
            method: 'POST',
            body
        }, {
            status(code) {
                this.code = code;
                return this;
            },
            json(data) {
                this.data = data;
                return this;
            }
        });

        return Response.json(result?.data || { ok: true }, {
            status: result?.code || 200
        });
    } catch (error) {
        console.error('Telegram webhook error:', error);
        return Response.json(
            { ok: false, error: error.message },
            { status: 500 }
        );
    }
}

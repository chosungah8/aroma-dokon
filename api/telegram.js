export function GET(request) {
    return new Response(
        JSON.stringify({
            success: true,
            message: "Telegram webhook tayyor"
        }),
        {
            status: 200,
            headers: {
                "Content-Type": "application/json"
            }
        }
    );
}

export async function POST(request) {
    const update = await request.json();

    console.log("Telegram update:", update);

    return new Response(
        JSON.stringify({
            success: true
        }),
        {
            status: 200,
            headers: {
                "Content-Type": "application/json"
            }
        }
    );
}

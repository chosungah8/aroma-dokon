export default async function handler(request) {
    if (request.method !== "POST") {
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

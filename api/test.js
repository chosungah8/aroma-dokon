export default function handler(request) {
    return new Response(
        JSON.stringify({
            success: true,
            message: "Vercel API ishlayapti"
        }),
        {
            status: 200,
            headers: {
                "Content-Type": "application/json"
            }
        }
    );
}

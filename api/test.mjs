export default function handler() {
    return new Response(
        JSON.stringify({
            success: true,
            message: "Aro'ma API ishlayapti"
        }),
        {
            status: 200,
            headers: {
                "content-type": "application/json"
            }
        }
    );
}

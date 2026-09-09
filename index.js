module.exports = async function (request) {
    return new Response(
        JSON.stringify({
            success: true,
            message: "Aro'ma Vercel server ishlayapti"
        }),
        {
            status: 200,
            headers: {
                "Content-Type": "application/json"
            }
        }
    );
};


module.exports = function handler(req, res) {
    if (req.method === "GET") {
        res.status(200).json({
            success: true,
            message: "Telegram webhook tayyor"
        });
        return;
    }

    if (req.method === "POST") {
        res.status(200).json({
            success: true
        });
        return;
    }

    res.status(405).json({
        success: false,
        message: "Method not allowed"
    });
};

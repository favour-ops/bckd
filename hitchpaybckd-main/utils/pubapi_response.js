exports.success = (res, data, message = "success") =>
  res.json({ status: "success", message, data });

exports.error = (res, code, message, status = 400) =>
  res.status(status).json({ status: "error", code, message });
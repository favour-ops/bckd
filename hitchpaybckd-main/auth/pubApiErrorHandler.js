exports.errorHandler = (err, req, res, next) => {
  console.error(err);
  res.status(err.statusCode || 500).json({
    status: "error",
    code: err.code || "SERVER_ERROR",
    message: err.message || "Something went wrong",
  });
};
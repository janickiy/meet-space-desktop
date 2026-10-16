// Keep WSS architecture-independent and prevent optional native-addon resolution.
process.env.WS_NO_BUFFER_UTIL = "1";
process.env.WS_NO_UTF_8_VALIDATE = "1";

import { DEBUG_MODE } from "../config.js";

import { createLogger, type Logger } from "./configLogger.js";

const logger: Logger = createLogger(DEBUG_MODE);

export default logger;

export const { debug, log, error, warn, info } = logger;
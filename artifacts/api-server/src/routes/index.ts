import { Router, type IRouter } from "express";
import healthRouter from "./health";
import browserRouter from "./browser";
import fixturesRouter from "./fixtures";

const router: IRouter = Router();

router.use(healthRouter);
router.use(fixturesRouter);
router.use(browserRouter);

export default router;

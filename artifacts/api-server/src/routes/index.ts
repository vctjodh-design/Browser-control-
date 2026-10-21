import { Router, type IRouter } from "express";
import healthRouter from "./health";
import browserRouter from "./browser";
import fixturesRouter from "./fixtures";
import processingRouter from "./processing";
import modelTrainingRouter from "./model-training";

const router: IRouter = Router();

router.use(healthRouter);
router.use(fixturesRouter);
router.use(processingRouter);
router.use(modelTrainingRouter);
router.use(browserRouter);

export default router;

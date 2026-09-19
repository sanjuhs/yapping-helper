import { Router, type IRouter } from "express";
import healthRouter from "./health";
import storageRouter from "./storage";
import jobsRouter from "./jobs";

const router: IRouter = Router();

router.use(healthRouter);
router.use(storageRouter);
router.use(jobsRouter);

export default router;

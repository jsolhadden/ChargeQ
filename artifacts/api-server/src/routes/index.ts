import { Router, type IRouter } from "express";
import healthRouter from "./health";
import chargersRouter from "./chargers";
import queueRouter from "./queue";
import sessionsRouter from "./sessions";
import dashboardRouter from "./dashboard";

const router: IRouter = Router();

router.use(healthRouter);
router.use(chargersRouter);
router.use(queueRouter);
router.use(sessionsRouter);
router.use(dashboardRouter);

export default router;

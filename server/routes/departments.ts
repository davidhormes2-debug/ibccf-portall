import { Router } from "express";
import { db } from "../db";
import { departments, departmentStages } from "@shared/schema";
import { eq, asc } from "drizzle-orm";

export const departmentsRouter = Router();

// Get all departments
departmentsRouter.get("/", async (req, res) => {
  try {
    const allDepartments = await db
      .select()
      .from(departments)
      .where(eq(departments.isActive, true))
      .orderBy(asc(departments.displayOrder));
    
    res.json(allDepartments);
  } catch (error) {
    console.error("Error fetching departments:", error);
    res.status(500).json({ error: "Failed to fetch departments" });
  }
});

// Get single department by ID
departmentsRouter.get("/:id", async (req, res) => {
  try {
    const departmentId = parseInt(req.params.id);
    const [department] = await db
      .select()
      .from(departments)
      .where(eq(departments.id, departmentId));
    
    if (!department) {
      return res.status(404).json({ error: "Department not found" });
    }
    
    res.json(department);
  } catch (error) {
    console.error("Error fetching department:", error);
    res.status(500).json({ error: "Failed to fetch department" });
  }
});

// Get department by key
departmentsRouter.get("/key/:key", async (req, res) => {
  try {
    const [department] = await db
      .select()
      .from(departments)
      .where(eq(departments.key, req.params.key));
    
    if (!department) {
      return res.status(404).json({ error: "Department not found" });
    }
    
    res.json(department);
  } catch (error) {
    console.error("Error fetching department:", error);
    res.status(500).json({ error: "Failed to fetch department" });
  }
});

// Get stages for a department
departmentsRouter.get("/:id/stages", async (req, res) => {
  try {
    const departmentId = parseInt(req.params.id);
    const stages = await db
      .select()
      .from(departmentStages)
      .where(eq(departmentStages.departmentId, departmentId))
      .orderBy(asc(departmentStages.stageOrder));
    
    res.json(stages);
  } catch (error) {
    console.error("Error fetching stages:", error);
    res.status(500).json({ error: "Failed to fetch stages" });
  }
});

// Admin: Create department
departmentsRouter.post("/", async (req, res) => {
  try {
    const { key, name, description, icon, color, displayOrder, workflowConfig } = req.body;
    
    const [newDepartment] = await db
      .insert(departments)
      .values({
        key,
        name,
        description,
        icon,
        color,
        displayOrder: displayOrder || '0',
        workflowConfig
      })
      .returning();
    
    res.status(201).json(newDepartment);
  } catch (error) {
    console.error("Error creating department:", error);
    res.status(500).json({ error: "Failed to create department" });
  }
});

// Admin: Update department
departmentsRouter.patch("/:id", async (req, res) => {
  try {
    const departmentId = parseInt(req.params.id);
    const updates = req.body;
    
    const [updated] = await db
      .update(departments)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(departments.id, departmentId))
      .returning();
    
    if (!updated) {
      return res.status(404).json({ error: "Department not found" });
    }
    
    res.json(updated);
  } catch (error) {
    console.error("Error updating department:", error);
    res.status(500).json({ error: "Failed to update department" });
  }
});

// Admin: Create stage for department
departmentsRouter.post("/:id/stages", async (req, res) => {
  try {
    const departmentId = parseInt(req.params.id);
    const { name, description, stageOrder, slaDays } = req.body;
    
    const [newStage] = await db
      .insert(departmentStages)
      .values({
        departmentId,
        name,
        description,
        stageOrder: stageOrder || '1',
        slaDays
      })
      .returning();
    
    res.status(201).json(newStage);
  } catch (error) {
    console.error("Error creating stage:", error);
    res.status(500).json({ error: "Failed to create stage" });
  }
});

// Admin: Update stage
departmentsRouter.patch("/stages/:stageId", async (req, res) => {
  try {
    const stageId = parseInt(req.params.stageId);
    const updates = req.body;
    
    const [updated] = await db
      .update(departmentStages)
      .set(updates)
      .where(eq(departmentStages.id, stageId))
      .returning();
    
    if (!updated) {
      return res.status(404).json({ error: "Stage not found" });
    }
    
    res.json(updated);
  } catch (error) {
    console.error("Error updating stage:", error);
    res.status(500).json({ error: "Failed to update stage" });
  }
});

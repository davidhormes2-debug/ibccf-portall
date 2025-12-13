import { Router } from "express";
import { storage } from "../storage";
import { z } from "zod";
import { checkAdminAuth } from "./middleware";

export const helpArticlesRouter = Router();

helpArticlesRouter.get("/", async (req, res) => {
  try {
    const articles = await storage.getAllHelpArticles();
    res.json(articles);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch help articles" });
  }
});

helpArticlesRouter.get("/category/:category", async (req, res) => {
  try {
    const articles = await storage.getHelpArticlesByCategory(req.params.category);
    res.json(articles);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch help articles" });
  }
});

helpArticlesRouter.get("/:id", async (req, res) => {
  try {
    const article = await storage.getHelpArticleById(parseInt(req.params.id));
    if (!article) {
      res.status(404).json({ error: "Article not found" });
      return;
    }
    res.json(article);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch help article" });
  }
});

helpArticlesRouter.post("/", checkAdminAuth, async (req, res) => {
  try {
    const articleInput = z.object({
      title: z.string().min(1),
      content: z.string().min(1),
      category: z.string().optional(),
      order: z.string().optional(),
      isPublished: z.boolean().optional()
    }).parse(req.body);

    const article = await storage.createHelpArticle(articleInput);
    res.json(article);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.errors });
    } else {
      res.status(500).json({ error: "Failed to create help article" });
    }
  }
});

helpArticlesRouter.patch("/:id", checkAdminAuth, async (req, res) => {
  try {
    const articleInput = z.object({
      title: z.string().min(1).optional(),
      content: z.string().min(1).optional(),
      category: z.string().optional(),
      order: z.string().optional(),
      isPublished: z.boolean().optional()
    }).parse(req.body);

    const article = await storage.updateHelpArticle(parseInt(req.params.id), articleInput);
    if (!article) {
      res.status(404).json({ error: "Article not found" });
      return;
    }
    res.json(article);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.errors });
    } else {
      res.status(500).json({ error: "Failed to update help article" });
    }
  }
});

helpArticlesRouter.delete("/:id", checkAdminAuth, async (req, res) => {
  try {
    await storage.deleteHelpArticle(parseInt(req.params.id));
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete help article" });
  }
});

export const userFeedbackRouter = Router();

userFeedbackRouter.get("/", checkAdminAuth, async (req, res) => {
  try {
    const feedback = await storage.getAllUserFeedback();
    res.json(feedback);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch user feedback" });
  }
});

export function registerCaseFeedbackRoutes(router: Router) {
  router.get("/:id/feedback", async (req, res) => {
    try {
      const feedback = await storage.getUserFeedbackByCaseId(req.params.id);
      res.json(feedback);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch user feedback" });
    }
  });

  router.post("/:id/feedback", async (req, res) => {
    try {
      const feedbackInput = z.object({
        rating: z.string().min(1),
        comment: z.string().optional(),
        feedbackType: z.string().optional()
      }).parse(req.body);

      const feedback = await storage.createUserFeedback({
        caseId: req.params.id,
        ...feedbackInput
      });
      res.json(feedback);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: error.errors });
      } else {
        res.status(500).json({ error: "Failed to create user feedback" });
      }
    }
  });
}

export const documentRequestsRouter = Router();

documentRequestsRouter.patch("/:id", async (req, res) => {
  try {
    const requestInput = z.object({
      status: z.enum(['pending', 'submitted', 'approved', 'rejected']).optional(),
      adminNotes: z.string().optional(),
      submittedFileData: z.string().optional(),
      submittedFileName: z.string().optional()
    }).parse(req.body);

    const request = await storage.updateDocumentRequest(parseInt(req.params.id), requestInput);
    if (!request) {
      res.status(404).json({ error: "Document request not found" });
      return;
    }
    res.json(request);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.errors });
    } else {
      res.status(500).json({ error: "Failed to update document request" });
    }
  }
});

export function registerCaseDocumentRoutes(router: Router) {
  router.get("/:id/document-requests", async (req, res) => {
    try {
      const requests = await storage.getDocumentRequestsByCaseId(req.params.id);
      res.json(requests);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch document requests" });
    }
  });

  router.post("/:id/document-requests", checkAdminAuth, async (req, res) => {
    try {
      const requestInput = z.object({
        documentType: z.string().min(1),
        description: z.string().optional(),
        deadline: z.string().optional()
      }).parse(req.body);

      const request = await storage.createDocumentRequest({
        caseId: req.params.id,
        ...requestInput,
        deadline: requestInput.deadline ? new Date(requestInput.deadline) : undefined
      });
      res.json(request);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: error.errors });
      } else {
        res.status(500).json({ error: "Failed to create document request" });
      }
    }
  });
}

export const translationsRouter = Router();

translationsRouter.get("/", async (req, res) => {
  try {
    const translations = await storage.getTranslationsByLocale('en');
    res.json(translations);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch translations" });
  }
});

translationsRouter.get("/:locale", async (req, res) => {
  try {
    const translations = await storage.getTranslationsByLocale(req.params.locale);
    res.json(translations);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch translations" });
  }
});

translationsRouter.post("/", checkAdminAuth, async (req, res) => {
  try {
    const translationInput = z.object({
      locale: z.string().min(1),
      key: z.string().min(1),
      value: z.string().min(1)
    }).parse(req.body);

    const translation = await storage.createTranslation(translationInput);
    res.json(translation);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.errors });
    } else {
      res.status(500).json({ error: "Failed to create translation" });
    }
  }
});

translationsRouter.patch("/:id", checkAdminAuth, async (req, res) => {
  try {
    const translationInput = z.object({
      value: z.string().min(1)
    }).parse(req.body);

    const translation = await storage.updateTranslation(parseInt(req.params.id), translationInput);
    if (!translation) {
      res.status(404).json({ error: "Translation not found" });
      return;
    }
    res.json(translation);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.errors });
    } else {
      res.status(500).json({ error: "Failed to update translation" });
    }
  }
});

translationsRouter.delete("/:id", checkAdminAuth, async (req, res) => {
  try {
    await storage.deleteTranslation(parseInt(req.params.id));
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete translation" });
  }
});

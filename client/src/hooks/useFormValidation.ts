import { useState, useCallback, FormEvent } from "react";
import { z } from "zod";

interface FormState<T> {
  data: T;
  errors: Record<string, string>;
  isSubmitting: boolean;
  submitError?: string;
}

export function useFormValidation<T extends z.ZodType>(
  schema: T,
  initialData: z.infer<T>
) {
  type FormData = z.infer<T>;
  
  const [state, setState] = useState<FormState<FormData>>({
    data: initialData,
    errors: {},
    isSubmitting: false,
    submitError: undefined,
  });

  const setValue = useCallback(<K extends keyof FormData>(key: K, value: FormData[K]) => {
    setState(prev => {
      const newErrors = { ...prev.errors };
      delete newErrors[key as string];
      return {
        ...prev,
        data: { ...prev.data, [key]: value },
        errors: newErrors,
      };
    });
  }, []);

  const setError = useCallback((key: string, error: string) => {
    setState(prev => ({
      ...prev,
      errors: { ...prev.errors, [key]: error },
    }));
  }, []);

  const validate = useCallback((): FormData | null => {
    const result = schema.safeParse(state.data);
    if (result.success) {
      setState(prev => ({ ...prev, errors: {} }));
      return result.data;
    }

    const errors: Record<string, string> = {};
    for (const error of result.error.errors) {
      const path = error.path.join(".");
      if (!errors[path]) {
        errors[path] = error.message;
      }
    }
    setState(prev => ({ ...prev, errors }));
    return null;
  }, [schema, state.data]);

  const handleSubmit = useCallback(
    (onSubmit: (data: FormData) => void | Promise<void>) => async (e?: FormEvent) => {
      e?.preventDefault();
      setState(prev => ({ ...prev, submitError: undefined }));

      const validData = validate();
      if (!validData) return;

      setState(prev => ({ ...prev, isSubmitting: true }));
      try {
        await onSubmit(validData);
      } catch (error) {
        setState(prev => ({
          ...prev,
          submitError: error instanceof Error ? error.message : "An error occurred",
        }));
      } finally {
        setState(prev => ({ ...prev, isSubmitting: false }));
      }
    },
    [validate]
  );

  const reset = useCallback(() => {
    setState({
      data: initialData,
      errors: {},
      isSubmitting: false,
      submitError: undefined,
    });
  }, [initialData]);

  const getError = useCallback((key: string): string | undefined => {
    return state.errors[key];
  }, [state.errors]);

  const hasErrors = Object.keys(state.errors).length > 0;

  return {
    data: state.data,
    errors: state.errors,
    isSubmitting: state.isSubmitting,
    submitError: state.submitError,
    setValue,
    setError,
    validate,
    handleSubmit,
    reset,
    getError,
    hasErrors,
  };
}

export default useFormValidation;

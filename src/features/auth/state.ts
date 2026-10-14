export interface SignInState {
  status: "idle" | "error";
  message: string;
  fieldErrors?: Record<string, string[]>;
}

export const INITIAL_SIGN_IN_STATE: SignInState = {
  status: "idle",
  message: "",
};

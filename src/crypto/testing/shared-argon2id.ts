import { argon2idDirect } from "../argon2";
import { memoizedArgon2id } from "./memoized-argon2id";

export const sharedMemoizedArgon2id = memoizedArgon2id(argon2idDirect);

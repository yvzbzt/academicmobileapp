import type { Connection, Model, Schema } from "mongoose";

export function getModel(connection: Connection, name: string, schema: Schema): Model<Record<string, unknown>> {
  return (connection.models[name] as Model<Record<string, unknown>> | undefined) ?? connection.model<Record<string, unknown>>(name, schema);
}

export function toDomainRecord<TRecord>(document: {
  id: string;
  toObject: (options?: { flattenMaps?: boolean }) => Record<string, unknown>;
}): TRecord {
  const { _id, __v, ...rest } = document.toObject({ flattenMaps: true });
  void _id;
  void __v;
  return { ...rest, id: document.id } as TRecord;
}

export function omitUndefined(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

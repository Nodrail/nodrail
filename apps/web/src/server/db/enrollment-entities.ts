import { Column, Entity } from "typeorm";
import { schema } from "./columns";

@Entity({ schema, name: "cancelled_enrollment_generations" })
export class CancelledEnrollmentGeneration {
  @Column({
    type: "uuid",
    primary: true,
    primaryKeyConstraintName: "cancelled_enrollment_generation_pk",
  })
  workspaceId!: string;
  @Column({
    type: "uuid",
    primary: true,
    primaryKeyConstraintName: "cancelled_enrollment_generation_pk",
  })
  environmentId!: string;
  @Column({
    type: "uuid",
    primary: true,
    primaryKeyConstraintName: "cancelled_enrollment_generation_pk",
  })
  projectId!: string;
  @Column({
    type: "uuid",
    primary: true,
    primaryKeyConstraintName: "cancelled_enrollment_generation_pk",
  })
  machineId!: string;
  @Column({
    type: "text",
    primary: true,
    primaryKeyConstraintName: "cancelled_enrollment_generation_pk",
  })
  generation!: string;
}

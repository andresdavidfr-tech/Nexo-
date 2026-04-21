export interface UserProfile {
  id?: string;
  uid: string;
  email: string;
  name: string;
  role: 'parent' | 'school' | 'admin';
  schoolId?: string;
  gradeId?: string;
  classId?: string;
  photoUrl?: string;
  assignedGrades?: string[]; // Granular permissions: list of grades a staff member is responsible for
  managedModules?: ('communications' | 'authorizations' | 'students' | 'scanning')[]; // Modules the staff member can access
}

export interface School {
  id: string;
  name: string;
  address: string;
  logoUrl?: string;
}

export interface Student {
  id: string;
  name: string;
  schoolId: string;
  parentId: string;
  photoUrl?: string;
  grade?: string;
  class?: string;
  turn?: 'morning' | 'afternoon' | 'evening';
  description?: string;
}

export interface Communication {
  id: string;
  schoolId: string;
  title: string;
  content: string;
  date: string;
  isImportant?: boolean;
  summary?: string;
  category?: 'event' | 'urgent' | 'info' | 'message';
  deadline?: string;
  readBy?: string[];
  targetGrades?: string[];
  location?: string;
  authorId?: string;
}

export interface Authorization {
  id: string;
  studentId: string;
  authorizedPersonName: string;
  authorizedPersonDni?: string;
  authorizedPersonPhotoUrl?: string;
  date: string;
  expiresAt?: string;
  qrCode: string;
  status: 'pending' | 'used' | 'expired';
  schoolId: string;
  parentId: string;
}

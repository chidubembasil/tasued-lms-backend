import { Test, TestingModule } from '@nestjs/testing';
import { ImportController } from './import.controller.js';
import { ImportService } from './import.service.js';

describe('ImportController', () => {
  let controller: ImportController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ImportController],
      providers: [ImportService],
    }).compile();

    controller = module.get<ImportController>(ImportController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
